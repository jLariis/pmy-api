import { AttachmentKind, Cobro } from './inbox.types';

/**
 * Plan de "Pegar FedEx" para un correo: qué lotes mandar al pegado (master, aéreo,
 * F2), con qué consolidado/fecha/sucursal, y qué cobros y guías de valor llevan.
 * Función pura; el servicio le pasa los datos ya cargados.
 */

export type PasteBatchKind = 'master' | 'aereo' | 'f2';

export interface PasteBatch {
  key: string; // estable por correo: tipo + id de adjunto
  kind: PasteBatchKind;
  attachmentId: string;
  filename: string;
  subsidiaryId: string | null;
  consNumber: string; // '' = lo captura el usuario en el pegado
  consDate: string; // YYYY-MM-DD (hora de Hermosillo)
  isAereo: boolean;
  raw: string; // TSV de la hoja, como si se copiara de Excel
  paymentsRaw: string; // cobros del cuerpo del correo en TSV
  hvRaw: string; // guías de valor (TSV de la hoja "valor")
  rows: number;
  blockedReason: string | null;
  done: boolean; // ya se mandó desde el correo
  duplicateOf?: string; // key del lote con las mismas guías
  sheet?: string; // hoja del libro (cuando el archivo trae varias)
}

export interface PlanAttachment {
  id: string; // único por unidad (adjunto, o adjunto + hoja)
  filename: string;
  kind: AttachmentKind;
  consNumber: string | null;
  tsv: string | null;
  /** Adjunto real cuando la unidad es una hoja de un libro con varias. */
  attachmentId?: string;
  sheet?: string;
}

export interface WorkbookSheet {
  name: string;
  role: 'master' | 'f2' | 'cod' | 'hv' | 'aereo' | null;
  tsv: string;
  rows: number;
}

/**
 * Un libro con varias hojas (YAQUI / F2 / COD / HV) se reparte en unidades: la hoja
 * principal conserva el tipo del archivo; F2 y AÉREO son bloques propios; HV entra como
 * "valor" (se suma al master marcado como alto valor). COD no es bloque: solo aporta
 * su tabla de cobros (Last COMM Scan Update) a `extraPayments`.
 */
export function expandWorkbook(
  att: { id: string; filename: string; kind: AttachmentKind; consNumber: string | null },
  sheets: WorkbookSheet[],
): { units: PlanAttachment[]; extraPayments: string; roles: Set<string> } {
  const roles = new Set<string>(sheets.map((s) => s.role ?? 'master'));
  if (sheets.length <= 1) {
    return { units: [{ ...att, tsv: sheets[0]?.tsv ?? null }], extraPayments: '', roles };
  }
  const units: PlanAttachment[] = [];
  let extraPayments = '';
  for (const s of sheets) {
    const base = { attachmentId: att.id, sheet: s.name, filename: att.filename, tsv: s.tsv, id: `${att.id}::${s.name}` };
    if (s.role === 'cod') {
      const lines = s.tsv.split('\n');
      const h = lines.findIndex((l) => /LAST COMM SCAN UPDATE|COD-COLLECT|^COD\b/i.test(l) && /TRACKING/i.test(l));
      if (h >= 0) extraPayments = [extraPayments, lines.slice(h).join('\n')].filter(Boolean).join('\n');
      continue;
    }
    if (s.role === 'f2') units.push({ ...base, kind: 'f2', consNumber: null });
    else if (s.role === 'hv') units.push({ ...base, kind: 'high_value', consNumber: null });
    else if (s.role === 'aereo') units.push({ ...base, kind: 'master_aereo', consNumber: null });
    else units.push({ ...base, kind: att.kind, consNumber: att.consNumber });
  }
  return { units, extraPayments, roles };
}

export interface PlanInput {
  subsidiaryId: string | null;
  receivedAt: Date;
  attachments: PlanAttachment[];
  announced: { consNumber: string; kind: string }[];
  cobros: Cobro[];
  /** Lotes ya mandados al pegado desde este correo (key). */
  doneKeys: string[];
  /** Cobros que vienen en una hoja COD del libro (TSV con encabezado). */
  extraPaymentsRaw?: string;
}

const TZ_OFFSET_MS = 7 * 3_600_000; // Hermosillo, UTC−7 fijo
export const hmoDay = (d: Date): string => new Date(d.getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10);

export function cobrosToTsv(cobros: Cobro[]): string {
  if (!cobros.length) return '';
  const lines = ['Tracking Number\tLast COMM Scan Date\tLast COMM Scan Update'];
  for (const c of cobros) {
    const concept = c.amount != null ? `${c.concept} ${c.amount} MXP` : c.concept;
    lines.push(`${c.trackingNumber}\t${c.date ?? ''}\t${concept}`);
  }
  return lines.join('\n');
}

const COBRO_HEADER = 'Tracking Number\tLast COMM Scan Date\tLast COMM Scan Update';

/**
 * Lista única de cobros [guía, fecha, concepto]: primero los del texto del correo y
 * luego los de hojas COD (sin repetir guía). Solo filas con concepto de cobro.
 */
export function collectCobroRows(cobros: Cobro[], extra: string): string[][] {
  const out = new Map<string, string[]>();
  for (const c of cobros) out.set(c.trackingNumber, [c.trackingNumber, c.date ?? '', c.amount != null ? `${c.concept} ${c.amount} MXP` : c.concept]);
  let idx: { t: number; d: number; u: number } | null = null;
  for (const line of (extra ?? '').split('\n')) {
    const cells = line.split('\t').map((s) => s.trim());
    if (cells.some((c) => /^tracking/i.test(c))) {
      idx = { t: cells.findIndex((c) => /^tracking/i.test(c)), d: cells.findIndex((c) => /date/i.test(c)), u: cells.findIndex((c) => /update|^cod$/i.test(c)) };
      continue;
    }
    if (!idx || idx.u < 0) continue;
    const t = cells[idx.t] ?? '';
    const u = cells[idx.u] ?? '';
    if (!/^\d{9,}$/.test(t) || !u || out.has(t)) continue;
    out.set(t, [t, idx.d >= 0 ? cells[idx.d] ?? '' : '', u]);
  }
  return [...out.values()];
}

/** Cobros del correo cuya guía no está en ninguno de los archivos (no se pueden aplicar). */
export function unmatchedCobros(i: Pick<PlanInput, 'cobros' | 'extraPaymentsRaw' | 'attachments'>): string[] {
  const all = new Set<string>();
  for (const a of i.attachments) tsvTrackings(a.tsv).trackings.forEach((t) => all.add(t));
  return collectCobroRows(i.cobros, i.extraPaymentsRaw ?? '').map((r) => r[0]).filter((t) => !all.has(t));
}

const rowCount = (tsv: string | null) => (tsv ? Math.max(0, tsv.split('\n').length - 1) : 0);

/** Número de consolidado en las filas ANTES del encabezado (fila "meta" de FedEx). */
export function tsvMetaConsNumber(tsv: string | null): string | null {
  if (!tsv) return null;
  const lines = tsv.split('\n');
  const h = lines.slice(0, 15).findIndex((l) => l.split('\t').some((c) => TRACKING_HEADER.test(c.trim())));
  for (const l of lines.slice(0, h < 0 ? 0 : h)) {
    const m = l.match(/(?<!\d)(\d{12,15})(?!\d)/);
    if (m) return m[1];
  }
  return null;
}

const TRACKING_HEADER = /^(tracking\s*(number|no\.?)?|gu[ií]a)$/i;

/** Guías (columna de tracking) y número de columnas del encabezado de un TSV. */
export function tsvTrackings(tsv: string | null): { trackings: Set<string>; columns: number } {
  const out = new Set<string>();
  if (!tsv) return { trackings: out, columns: 0 };
  const rows = tsv.split('\n').map((l) => l.split('\t'));
  const h = rows.slice(0, 15).findIndex((r) => r.some((c) => TRACKING_HEADER.test(c.trim())));
  if (h < 0) return { trackings: out, columns: 0 };
  const col = rows[h].findIndex((c) => TRACKING_HEADER.test(c.trim()));
  for (const r of rows.slice(h + 1)) {
    const t = (r[col] ?? '').trim();
    if (t) out.add(t);
  }
  return { trackings: out, columns: rows[h].filter((c) => c.trim()).length };
}

/** ¿Dos archivos traen prácticamente las mismas guías? (≥ 90 % del menor) */
function sameShipments(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  small.forEach((t) => {
    if (big.has(t)) common++;
  });
  return common / small.size >= 0.9;
}

export function buildPastePlan(i: PlanInput): PasteBatch[] {
  const consDate = hmoDay(i.receivedAt);
  const cobroRows = collectCobroRows(i.cobros, i.extraPaymentsRaw ?? '');
  /** Cobros que pertenecen a las guías del bloque (si no, el pegado los agregaría como guías sueltas). */
  const cobrosFor = (...tsvs: (string | null)[]) => {
    const own = new Set<string>();
    for (const t of tsvs) tsvTrackings(t).trackings.forEach((x) => own.add(x));
    const rows = cobroRows.filter((r) => own.has(r[0]));
    return rows.length ? [COBRO_HEADER, ...rows.map((r) => r.join('\t'))].join('\n') : '';
  };
  const hvRaw = i.attachments
    .filter((a) => a.kind === 'high_value' && a.tsv)
    .map((a) => a.tsv as string)
    .join('\n');
  const announcedMaster = i.announced.find((a) => a.kind === 'master')?.consNumber ?? null;
  const announcedF2 = i.announced.find((a) => a.kind === 'f2')?.consNumber ?? null;
  const masterFiles = i.attachments.filter((a) => a.kind === 'master');
  // Las guías de valor van COMPLETAS en un solo lote: el aéreo si hay; si no, el primer master;
  // si el correo solo trae "valor", ese archivo es su propio lote.
  const hvOwnerId =
    i.attachments.find((a) => a.kind === 'master_aereo')?.id ??
    masterFiles[0]?.id ??
    i.attachments.find((a) => a.kind === 'high_value' && a.tsv)?.id ??
    null;
  const out: PasteBatch[] = [];

  for (const a of i.attachments) {
    let kind: PasteBatchKind | null = null;
    if (a.kind === 'master') kind = 'master';
    else if (a.kind === 'master_aereo') kind = 'aereo';
    else if (a.kind === 'f2') kind = 'f2';
    else if (a.kind === 'high_value' && a.id === hvOwnerId) kind = 'master';
    if (!kind) continue;

    let consNumber = '';
    let blockedReason: string | null = null;
    // Número de consolidado: el de la primera fila del archivo (FedEx lo pone ahí:
    // "305821338193 … SALIDA AEREA"), luego el del nombre, luego el del cuerpo del correo.
    // Si no aparece en ningún lado, el pegado lo pide.
    const own = tsvMetaConsNumber(a.tsv) ?? a.consNumber;
    if (kind === 'master') {
      consNumber = own ?? (masterFiles.length === 1 ? announcedMaster ?? '' : '');
    } else if (kind === 'f2') {
      consNumber = announcedF2 ?? own ?? announcedMaster ?? '';
    } else {
      consNumber = own ?? (!masterFiles.length ? announcedMaster ?? '' : '');
    }
    if (!a.tsv) blockedReason = 'No se pudieron leer las guías de este archivo';
    if (!i.subsidiaryId) blockedReason = blockedReason ?? 'Falta confirmar la sucursal';

    const key = `${kind}:${a.id}`;
    out.push({
      key,
      kind,
      attachmentId: a.attachmentId ?? a.id,
      sheet: a.sheet,
      filename: a.sheet ? `${a.filename} · hoja "${a.sheet}"` : a.filename,
      subsidiaryId: i.subsidiaryId,
      consNumber,
      consDate,
      isAereo: kind === 'aereo',
      raw: a.tsv ?? '',
      paymentsRaw: cobrosFor(a.tsv, a.id === hvOwnerId ? hvRaw : null),
      hvRaw: a.id === hvOwnerId ? hvRaw : '',
      rows: tsvTrackings(a.tsv).trackings.size || rowCount(a.tsv),
      blockedReason,
      done: i.doneKeys.includes(key),
    });
  }
  // Archivos repetidos (p. ej. "367.xlsx" y "PREALERTA … RUTA 367.xlsx"): se deja el más completo.
  const info = new Map(out.map((b) => [b.key, tsvTrackings(b.raw)]));
  const ranked = [...out].sort((x, y) => (info.get(y.key)!.columns - info.get(x.key)!.columns) || y.rows - x.rows);
  const kept: PasteBatch[] = [];
  for (const b of ranked) {
    const twin = kept.find((k) => k.kind === b.kind && sameShipments(info.get(k.key)!.trackings, info.get(b.key)!.trackings));
    if (twin) {
      b.blockedReason = `Mismas guías que "${twin.filename}" (no se sube dos veces)`;
      b.duplicateOf = twin.key;
    } else kept.push(b);
  }
  // Orden del día: master → aéreo → F2; los repetidos al final.
  const order: Record<PasteBatchKind, number> = { master: 0, aereo: 1, f2: 2 };
  return out.sort((x, y) => Number(!!x.duplicateOf) - Number(!!y.duplicateOf) || order[x.kind] - order[y.kind]);
}
