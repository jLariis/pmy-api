import { AnnouncedCons, Cobro } from './inbox.types';

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

export function extractConsolidations(text: string): AnnouncedCons[] {
  const t = flat(text);
  const out: AnnouncedCons[] = [];
  const add = (consNumber: string, kind: 'master' | 'f2', count: string | null) => {
    if (out.some((o) => o.consNumber === consNumber)) return;
    out.push({ consNumber, kind, announcedCount: count ? Number(count) : null });
  };

  const patterns: { re: RegExp; kind: 'master' | 'f2' }[] = [
    { re: new RegExp(`\\bMASTER\\s*[:#]?\\s*${CONS}${GUIAS}`, 'g'), kind: 'master' },
    { re: new RegExp(`\\bF2\\s*[:#]?\\s*${CONS}${GUIAS}`, 'g'), kind: 'f2' },
    { re: new RegExp(`\\bCARGA YAQUI\\s*[:#]?\\s*${CONS}${GUIAS}`, 'g'), kind: 'master' },
  ];
  type Hit = { index: number; cons: string; kind: 'master' | 'f2'; count: string };
  const hits: Hit[] = [];
  for (const p of patterns) {
    for (const m of t.matchAll(p.re)) hits.push({ index: m.index ?? 0, cons: m[1], kind: p.kind, count: m[2] });
  }
  hits.sort((a, b) => a.index - b.index).forEach((h) => add(h.cons, h.kind, h.count));

  // Formato PREALERTA: "PAQUETES:123 ... CONS:818861721255"
  const consMatches = [...t.matchAll(new RegExp(`\\bCONS\\s*[:#]?\\s*${CONS}`, 'g'))];
  if (consMatches.length) {
    const paq = t.match(/\bPAQUETES\s*[:#]?\s*(\d{1,5})/);
    for (const m of consMatches) add(m[1], 'master', consMatches.length === 1 && paq ? paq[1] : null);
  }
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
