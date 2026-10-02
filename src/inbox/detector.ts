import { normalize, splitSignature, stripBoilerplate } from './text-normalize.util';
import { DetectionInput, DetectionResult, Knowledge, KnowledgeAlias, Region, Signal, SignalType } from './inbox.types';

/**
 * Motor de detección de sucursal para correos FedEx. Función pura: recibe el
 * correo ya parseado + el "conocimiento" (catálogo, cobertura CP, alias aprendidos,
 * consolidados registrados) y devuelve la sucursal con cada señal que votó.
 *
 * Criterio: preferir mandar a revisión antes que equivocarse. `autoSafe` solo si
 * ≥2 señales independientes (una fuerte), ninguna en contra y confianza ≥ 0.85.
 */

export const DETECTOR_VERSION = 1;

export const WEIGHTS = {
  consolidado_conocido: 1.0,
  cp_archivo: 0.9,
  ciudad_archivo: 0.6,
  asunto_o_archivo: 0.8,
  cuerpo: 0.5,
  remitente: 0.7,
  copia: 0.4,
  estacion: 0.4,
} as const;

export const CP_MIN_FRACTION = 0.85;
export const ZIP_DOMINANT_SHARE = 0.7;
export const MIN_CONFIDENCE = 0.85;
export const CONFLICT_WEIGHT = 0.5;
export const SENDER_MIN_HITS = 5;
export const ALIAS_MIN_HITS = 3;
export const MIN_CONCENTRATION = 0.9;
export const MIN_ALIAS_PRECISION = 0.7;

const STRONG: SignalType[] = ['consolidado_conocido', 'cp_archivo'];

/** Palabras que aparecen en casi todos los correos y no identifican sucursal. */
export const GENERIC_TERMS = new Set([
  'YAQUI', 'CARGA', 'PAQUETERIA', 'MENSAJERIA', 'SALIDA', 'PREALERTA', 'DEL', 'LA', 'EL', 'LOS', 'DE', 'Y',
  'LOCAL', 'RUTA', 'MASTER', 'AEREO', 'AEREA', 'VALOR', 'CCP', 'F2', 'XLSX', 'XLS', 'ODS', 'CSV', 'PDF',
  'PQT', 'FEDEX', 'SENSITIVE', 'EXTERNAL', 'RE', 'RV', 'FW', 'FWD', 'CONS', 'GUIAS', 'COBROS', 'BODEGA',
  'CIUDAD', 'CUIDAD', 'CD', 'SA', 'CV', 'OCT', 'SEP', 'NOV', 'DIC', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY',
  'JUN', 'JUL', 'AGO',
]);

const SIGNAL_LABEL: Record<SignalType, string> = {
  consolidado_conocido: 'consolidado ya registrado',
  cp_archivo: 'códigos postales del archivo',
  ciudad_archivo: 'ciudades del archivo',
  asunto_o_archivo: 'asunto o nombre del archivo',
  cuerpo: 'texto del correo',
  remitente: 'remitente',
  copia: 'copias del correo',
  estacion: 'código de estación',
};

// ---------------------------------------------------------------------------
// Términos por sucursal
// ---------------------------------------------------------------------------

/** Distancia de edición ≤ 1 (incluye intercambio de dos letras vecinas: CIUDAD/CUIDAD). */
function levenshtein1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  }
  return false;
}

const PREFIXES = /^(BODEGA|CIUDAD|CUIDAD|CD|PUERTO)\s+/;

interface Term { term: string; subsidiaryId: string; weightFactor: number; origin: string; isFullName?: boolean }

/** Nombre completo + variante sin prefijo (solo si nadie más la reclama) + ciudades de cobertura + alias. */
export function buildTerms(k: Knowledge): Term[] {
  const candidates: Term[] = [];
  for (const s of k.subsidiaries) {
    const full = normalize(s.name);
    if (!full) continue;
    candidates.push({ term: full, subsidiaryId: s.id, weightFactor: 1, origin: 'nombre', isFullName: true });
    const short = full.replace(PREFIXES, '');
    if (short !== full && short.length >= 4) candidates.push({ term: short, subsidiaryId: s.id, weightFactor: 1, origin: 'nombre' });
  }
  // Ciudades donde una sucursal domina la cobertura.
  const cityBySub = new Map<string, Map<string, number>>();
  for (const z of k.zipCoverage) {
    if (z.status === 'excluido' || !z.city || z.share < ZIP_DOMINANT_SHARE) continue;
    const c = normalize(z.city);
    if (!c || GENERIC_TERMS.has(c)) continue;
    const m = cityBySub.get(c) ?? new Map<string, number>();
    m.set(z.subsidiaryId, (m.get(z.subsidiaryId) ?? 0) + 1);
    cityBySub.set(c, m);
  }
  for (const [city, m] of cityBySub) {
    const [best] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    candidates.push({ term: city, subsidiaryId: best[0], weightFactor: 1, origin: 'ciudad de su cobertura' });
  }
  for (const a of k.aliases) {
    if (a.signalType !== 'termino') continue;
    const p = precision(a);
    if (a.hits < 2 || p < MIN_ALIAS_PRECISION) continue;
    candidates.push({ term: normalize(a.term), subsidiaryId: a.subsidiaryId, weightFactor: p, origin: 'aprendido' });
  }
  // Un término reclamado por más de una sucursal no identifica a ninguna.
  const owners = new Map<string, Set<string>>();
  for (const c of candidates) {
    const s = owners.get(c.term) ?? new Set<string>();
    s.add(c.subsidiaryId);
    owners.set(c.term, s);
  }
  const fullNames = new Set(candidates.filter((c) => c.isFullName).map((c) => c.term));
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (!c.term || GENERIC_TERMS.has(c.term)) return false;
    // El nombre completo siempre identifica a su sucursal; las variantes solo si nadie más las reclama.
    if (!c.isFullName && (fullNames.has(c.term) || (owners.get(c.term)?.size ?? 0) > 1)) return false;
    const key = `${c.term}|${c.subsidiaryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface TermHit { term: Term; position: number }

/** Coincidencias por palabra completa (tolerancia de 1 letra en términos ≥ 6); el término más largo gana. */
export function findTerms(text: string, terms: Term[]): TermHit[] {
  const words = normalize(text).split(' ').filter(Boolean);
  const hits: (TermHit & { start: number; end: number })[] = [];
  for (const t of terms) {
    const tw = t.term.split(' ');
    for (let i = 0; i + tw.length <= words.length; i++) {
      const window = words.slice(i, i + tw.length).join(' ');
      const ok = window === t.term || (t.term.length >= 6 && levenshtein1(window, t.term));
      if (ok) { hits.push({ term: t, position: i, start: i, end: i + tw.length }); break; }
    }
  }
  // Quitar los contenidos dentro de un término más largo ("OBREGON" dentro de "BODEGA OBREGON").
  return hits.filter((h) => !hits.some((o) => o !== h && o.term.term.length > h.term.term.length && o.start <= h.start && o.end >= h.end));
}

// ---------------------------------------------------------------------------
// Alias aprendidos (remitente, copia, estación)
// ---------------------------------------------------------------------------

export function precision(a: { hits: number; misses: number }): number {
  const total = a.hits + a.misses;
  return total === 0 ? 0 : a.hits / total;
}

/** Sucursal dominante de un término aprendido, si está concentrado. */
function concentrated(aliases: KnowledgeAlias[], minHits: number): { subsidiaryId: string; concentration: number; hits: number; total: number } | null {
  const total = aliases.reduce((s, a) => s + a.hits, 0);
  if (total < minHits) return null;
  const best = [...aliases].sort((a, b) => b.hits - a.hits)[0];
  const concentration = best.hits / total;
  if (concentration < MIN_CONCENTRATION || precision(best) < MIN_ALIAS_PRECISION) return null;
  return { subsidiaryId: best.subsidiaryId, concentration, hits: best.hits, total };
}

function aliasesFor(k: Knowledge, type: KnowledgeAlias['signalType'], term: string): KnowledgeAlias[] {
  const t = term.toLowerCase();
  return k.aliases.filter((a) => a.signalType === type && a.term.toLowerCase() === t);
}

/** Códigos tipo estación (4 letras, p. ej. SJDA, HMOA) en asunto y nombres de archivo. */
export function stationCodes(subject: string, filenames: string[]): string[] {
  const words = [subject, ...filenames].flatMap((s) => normalize(s.replace(/\.[a-z0-9]+$/i, '')).split(' '));
  return [...new Set(words.filter((w) => /^[A-Z]{4}$/.test(w) && !GENERIC_TERMS.has(w)))];
}

// ---------------------------------------------------------------------------
// Región por firma
// ---------------------------------------------------------------------------

export function regionFromSignature(signature: string): Region | null {
  const s = normalize(signature);
  const bcs = /\b(LA PAZ|BAJA CALIFORNIA SUR|BCS|LOS CABOS)\b/.test(s);
  const son = /\b(HMOA|HERMOSILLO|SONORA|NOGA)\b/.test(s);
  if (bcs && !son) return 'BCS';
  if (son && !bcs) return 'SON';
  return null;
}

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

export function detect(input: DetectionInput): DetectionResult {
  const k = input.knowledge;
  const signals: Signal[] = [];
  const nameOf = (id: string) => k.subsidiaries.find((s) => s.id === id)?.name ?? id;

  const { body, signature } = splitSignature(stripBoilerplate(input.top));
  const region = regionFromSignature(signature);
  const regionOk = (id: string) => {
    const r = k.subsidiaries.find((s) => s.id === id)?.region ?? null;
    return !region || !r || r === region;
  };

  // 1) Consolidado ya registrado
  for (const cons of input.consNumbers) {
    const hit = k.knownConsolidations.find((c) => c.consNumber === cons);
    if (hit && !signals.some((s) => s.type === 'consolidado_conocido' && s.subsidiaryId === hit.subsidiaryId)) {
      signals.push({ type: 'consolidado_conocido', value: cons, subsidiaryId: hit.subsidiaryId, weight: WEIGHTS.consolidado_conocido, note: `El consolidado ${cons} ya está registrado en ${nameOf(hit.subsidiaryId)}` });
    }
  }

  // 2) CP del archivo
  const zipCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  for (const a of input.attachments) {
    if (a.kind === 'pdf' || a.kind === 'other' || a.kind === 'ccp_ignored') continue;
    for (const [z, n] of Object.entries(a.zips)) zipCounts[z] = (zipCounts[z] ?? 0) + n;
    for (const [c, n] of Object.entries(a.cities)) cityCounts[c] = (cityCounts[c] ?? 0) + n;
  }
  let cpAmbiguous: string[] | null = null;
  const totalZipRows = Object.values(zipCounts).reduce((s, n) => s + n, 0);
  if (totalZipRows > 0) {
    const bySub: Record<string, number> = {};
    const ambiguousBySub: Record<string, number> = {};
    let confirmedRows = 0;
    for (const [zip, n] of Object.entries(zipCounts)) {
      const cov = k.zipCoverage.filter((z) => z.zip === zip && z.status !== 'excluido').sort((a, b) => b.share - a.share);
      if (!cov.length) continue;
      if (cov[0].share >= ZIP_DOMINANT_SHARE) {
        bySub[cov[0].subsidiaryId] = (bySub[cov[0].subsidiaryId] ?? 0) + n;
        if (cov[0].status === 'confirmado') confirmedRows += n;
      } else {
        for (const c of cov.slice(0, 2)) ambiguousBySub[c.subsidiaryId] = (ambiguousBySub[c.subsidiaryId] ?? 0) + n;
      }
    }
    const best = Object.entries(bySub).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] / totalZipRows >= CP_MIN_FRACTION) {
      const frac = best[1] / totalZipRows;
      const factor = confirmedRows / best[1] >= 0.5 ? 1 : 0.8;
      signals.push({ type: 'cp_archivo', value: `${Math.round(frac * 100)}%`, subsidiaryId: best[0], weight: +(WEIGHTS.cp_archivo * factor).toFixed(3), note: `${Math.round(frac * 100)}% de las guías del archivo son de códigos postales de ${nameOf(best[0])}` });
    } else {
      const amb = Object.entries(ambiguousBySub).sort((a, b) => b[1] - a[1]);
      if (amb.length >= 2 && amb[0][1] / totalZipRows >= 0.5) cpAmbiguous = [amb[0][0], amb[1][0]];
    }
  }

  // 3) Ciudades del archivo (respaldo si no votó el CP)
  if (!signals.some((s) => s.type === 'cp_archivo')) {
    const totalCity = Object.values(cityCounts).reduce((s, n) => s + n, 0);
    if (totalCity > 0) {
      const terms = buildTerms(k);
      const bySub: Record<string, number> = {};
      for (const [city, n] of Object.entries(cityCounts)) {
        const t = terms.find((x) => x.term === city);
        if (t) bySub[t.subsidiaryId] = (bySub[t.subsidiaryId] ?? 0) + n;
      }
      const best = Object.entries(bySub).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] / totalCity >= CP_MIN_FRACTION) {
        signals.push({ type: 'ciudad_archivo', value: `${Math.round((best[1] / totalCity) * 100)}%`, subsidiaryId: best[0], weight: WEIGHTS.ciudad_archivo, note: `Las ciudades de destino del archivo son de ${nameOf(best[0])}` });
      }
    }
  }

  // 4) Asunto y nombres de archivo
  const terms = buildTerms(k);
  const headerText = [input.subject, ...input.attachments.map((a) => a.filename.replace(/\.[a-z0-9]+$/i, ''))].join(' \n ');
  const headerHits = findTerms(headerText, terms);
  for (const h of headerHits) {
    if (signals.some((s) => s.type === 'asunto_o_archivo' && s.subsidiaryId === h.term.subsidiaryId)) continue;
    signals.push({ type: 'asunto_o_archivo', value: h.term.term, subsidiaryId: h.term.subsidiaryId, weight: +(WEIGHTS.asunto_o_archivo * h.term.weightFactor).toFixed(3), note: `El asunto o el archivo dice "${h.term.term}" (${h.term.origin})` });
  }

  // 5) Cuerpo: solo la primera sucursal mencionada (origen de "RUTA: A-B-C")
  const bodyHits = findTerms(body, terms).sort((a, b) => a.position - b.position);
  if (bodyHits.length) {
    const first = bodyHits[0];
    signals.push({ type: 'cuerpo', value: first.term.term, subsidiaryId: first.term.subsidiaryId, weight: +(WEIGHTS.cuerpo * first.term.weightFactor).toFixed(3), note: `El correo menciona primero "${first.term.term}"` });
  }

  // 6) Remitente
  const sender = concentrated(aliasesFor(k, 'remitente', input.fromAddress), SENDER_MIN_HITS);
  if (sender) {
    signals.push({ type: 'remitente', value: input.fromAddress, subsidiaryId: sender.subsidiaryId, weight: +(WEIGHTS.remitente * sender.concentration).toFixed(3), note: `${input.fromAddress} manda casi siempre de ${nameOf(sender.subsidiaryId)} (${sender.hits} de ${sender.total})` });
  }

  // 7) Copias
  const ccBest = new Map<string, Signal>();
  for (const cc of input.ccAddresses) {
    const c = concentrated(aliasesFor(k, 'copia', cc), ALIAS_MIN_HITS);
    if (!c) continue;
    const w = +(WEIGHTS.copia * c.concentration).toFixed(3);
    const prev = ccBest.get(c.subsidiaryId);
    if (!prev || prev.weight < w) ccBest.set(c.subsidiaryId, { type: 'copia', value: cc, subsidiaryId: c.subsidiaryId, weight: w, note: `${cc} en copia suele ser de ${nameOf(c.subsidiaryId)}` });
  }
  signals.push(...ccBest.values());

  // 8) Código de estación
  for (const code of stationCodes(input.subject, input.attachments.map((a) => a.filename))) {
    const c = concentrated(aliasesFor(k, 'estacion', code), ALIAS_MIN_HITS);
    if (!c || signals.some((s) => s.type === 'estacion' && s.subsidiaryId === c.subsidiaryId)) continue;
    signals.push({ type: 'estacion', value: code, subsidiaryId: c.subsidiaryId, weight: +(WEIGHTS.estacion * c.concentration).toFixed(3), note: `El código ${code} corresponde a ${nameOf(c.subsidiaryId)}` });
  }

  // Región por firma: descarta solo pistas débiles de la otra región; las fuertes se
  // conservan y, si la ganadora es de otra región, el correo va a revisión.
  const kept = signals.filter((s) => s.weight >= CONFLICT_WEIGHT || regionOk(s.subsidiaryId));

  return decide(kept, nameOf, cpAmbiguous, (id) => (regionOk(id) ? null : region));
}

function decide(
  signals: Signal[],
  nameOf: (id: string) => string,
  cpAmbiguous: string[] | null,
  regionMismatch: (id: string) => Region | null,
): DetectionResult {
  const base = { signals, detectorVersion: DETECTOR_VERSION };
  const scores = new Map<string, number>();
  for (const s of signals) scores.set(s.subsidiaryId, (scores.get(s.subsidiaryId) ?? 0) + s.weight);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  if (!ranked.length) {
    const reason = cpAmbiguous
      ? `Los códigos postales se comparten entre ${nameOf(cpAmbiguous[0])} y ${nameOf(cpAmbiguous[1])} y no hay otra pista`
      : 'No hay datos suficientes para saber la sucursal';
    return { ...base, subsidiaryId: null, confidence: 0, autoSafe: false, runnerUp: null, reason };
  }

  const [winner, top] = ranked[0];
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const confidence = +(top / total).toFixed(3);
  const runnerUp = ranked[1] ? { subsidiaryId: ranked[1][0], score: +ranked[1][1].toFixed(3) } : null;
  const mine = signals.filter((s) => s.subsidiaryId === winner);
  const types = new Set(mine.map((s) => s.type));
  const strong = mine.some((s) => STRONG.includes(s.type));
  const against = signals.find((s) => s.subsidiaryId !== winner && s.weight >= CONFLICT_WEIGHT);
  const winnerName = nameOf(winner);

  let reason: string;
  let autoSafe = false;
  if (against) {
    const forWinner = [...mine].sort((a, b) => b.weight - a.weight)[0];
    reason = `${cap(SIGNAL_LABEL[forWinner.type])} apunta a ${winnerName}, pero ${SIGNAL_LABEL[against.type]} apunta a ${nameOf(against.subsidiaryId)}`;
  } else if (types.size < 2) {
    reason = `Solo una pista apunta a ${winnerName} (${SIGNAL_LABEL[mine[0].type]}); falta confirmarlo con otra`;
  } else if (!strong) {
    reason = cpAmbiguous
      ? `Apunta a ${winnerName}, pero los códigos postales se comparten entre ${nameOf(cpAmbiguous[0])} y ${nameOf(cpAmbiguous[1])}`
      : `Apunta a ${winnerName}, pero ni los códigos postales ni un consolidado registrado lo confirman`;
  } else if (regionMismatch(winner)) {
    reason = `Apunta a ${winnerName}, pero la firma del correo es de ${regionMismatch(winner) === 'BCS' ? 'Baja California Sur' : 'Sonora'}`;
  } else if (confidence < MIN_CONFIDENCE) {
    reason = `Apunta a ${winnerName}, pero con poca ventaja sobre ${runnerUp ? nameOf(runnerUp.subsidiaryId) : 'otra sucursal'}`;
  } else {
    autoSafe = true;
    reason = `Detectado por: ${[...types].map((t) => SIGNAL_LABEL[t]).join(' · ')}`;
  }
  return { ...base, subsidiaryId: winner, confidence, autoSafe, runnerUp, reason };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
