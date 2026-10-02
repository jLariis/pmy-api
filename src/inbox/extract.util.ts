import { AnnouncedCons, AnnouncedKind, Cobro } from './inbox.types';

/**
 * Extracción de datos del cuerpo de correos FedEx: consolidados anunciados
 * (MASTER/F2/CARGA/CONS + guías) y la tabla de cobros (COD/FTC/PIP).
 * Trabaja sobre el mensaje superior (ya sin historial del hilo).
 */

/** Mayúsculas, sin acentos, espacios colapsados; conserva . / , : y dígitos. */
function flat(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

const CONS = '(\\d{10,15})';
const GUIAS = '\\s*[,.:]?\\s*(\\d{1,5})\\s*GUIAS';

/** Etiqueta del cuerpo → tipo de consolidado. El orden importa: "CONS MASTER" antes que "CONS"/"MASTER". */
const LABELS: { re: string; kind: AnnouncedKind }[] = [
  { re: 'CONS\\s+MASTER', kind: 'master' },
  { re: 'CARGA\\s+YAQUI', kind: 'master' },
  { re: 'MASTER', kind: 'master' },
  { re: 'CONS', kind: 'master' },
  { re: 'COD', kind: 'cod' },
  { re: 'F2', kind: 'f2' },
  { re: 'HV', kind: 'high_value' },
  { re: 'VALOR', kind: 'high_value' },
  { re: 'AEREO', kind: 'aereo' },
];

/**
 * "ETIQUETA [:#] número [, guías | guías GUIAS]". Variantes reales:
 *   MASTER 305821242296, 189 GUIAS · F2 305821512729 , 15GUIAS · CARGA YAQUI 305821198046, 87 GUIAS
 *   CONS MASTER : 305820438524 ,291 · COD:  305820614853 ,7 · HV:  305820303788, 1 · CONS:818861721255
 * El conteo solo se toma si va tras coma/punto o seguido de GUIAS (evita tomar números sueltos).
 */
const ANNOUNCED_RE = new RegExp(
  `\\b(${LABELS.map((l) => l.re).join('|')})\\s*[:#]?\\s*${CONS}(?!\\d)(?:\\s*[,.]\\s*(\\d{1,5})(?!\\d)|${GUIAS})?`,
  'g',
);

export function extractConsolidations(text: string): AnnouncedCons[] {
  const t = flat(text);
  const out: AnnouncedCons[] = [];
  for (const m of t.matchAll(ANNOUNCED_RE)) {
    const label = m[1].replace(/\s+/g, ' ');
    const kind = LABELS.find((l) => new RegExp(`^${l.re}$`).test(label))?.kind ?? 'master';
    const consNumber = m[2];
    const count = m[3] ?? m[4] ?? null;
    if (out.some((o) => o.consNumber === consNumber)) continue;
    out.push({ consNumber, kind, announcedCount: count ? Number(count) : null });
  }
  // Formato PREALERTA: "PAQUETES:123 … CONS:818861721255" (el conteo va en otra línea).
  const onlyMaster = out.filter((o) => o.kind === 'master');
  const paq = t.match(/\bPAQUETES\s*[:#]?\s*(\d{1,5})/);
  if (paq && onlyMaster.length === 1 && onlyMaster[0].announcedCount == null) onlyMaster[0].announcedCount = Number(paq[1]);
  return out;
}

const COBRO_RE =
  /\b(\d{12})\s+(?:(\d{2}\/\d{2}\/\d{4})\s+)?((COD|FTC)-COLLECT CASH\s+([\d,]+(?:\.\d+)?)\s*MXP|PIP NO AHS)/g;

export function extractCobros(text: string): Cobro[] {
  const t = flat(text);
  const out: Cobro[] = [];
  for (const m of t.matchAll(COBRO_RE)) {
    const isPip = m[3] === 'PIP NO AHS';
    out.push({
      trackingNumber: m[1],
      date: m[2] ?? null,
      concept: isPip ? 'PIP NO AHS' : `${m[4]}-COLLECT CASH`,
      amount: isPip ? null : Number(m[5].replace(/,/g, '')),
    });
  }
  return out;
}

export function numbersInFilename(name: string): string[] {
  return [...(name ?? '').matchAll(/(?<!\d)(\d{12,15})(?!\d)/g)].map((m) => m[1]);
}
