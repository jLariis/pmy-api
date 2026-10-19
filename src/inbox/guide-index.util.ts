import type { SheetTsv } from './attachment-classify.util';
import { tsvTrackings } from './paste-plan.util';

/**
 * Índice del buscador de Correos: qué guías trae cada correo y en qué archivo/hoja.
 * Puro (sin BD ni disco) para poder probarlo.
 */
export interface IndexedGuide {
  inboxAttachmentId: string | null;
  /** Hoja del libro; null = archivo de una sola hoja o cuerpo del correo. */
  sheet: string | null;
  /** master | master_aereo | f2 | high_value | cod | dhl | cobro */
  unitKind: string;
  unitConsNumber: string | null;
  trackingNumber: string;
}

/** Guía limpia: sin espacios ni apóstrofo de Excel; null si no parece guía. */
export function cleanTracking(raw: unknown): string | null {
  const t = String(raw ?? '')
    .replace(/^'+/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return /^[A-Z0-9]{8,40}$/.test(t) && /\d{6,}/.test(t) ? t : null;
}

const ROLE_KIND: Record<string, string> = { f2: 'f2', hv: 'high_value', aereo: 'master_aereo', cod: 'cod' };

/** Guías de todas las hojas de un libro (incluye COD: el cobro también es "dónde llegó la guía"). */
export function guidesFromSheets(
  att: { id: string; kind: string; consNumber: string | null },
  sheets: SheetTsv[],
): IndexedGuide[] {
  const out: IndexedGuide[] = [];
  const seen = new Set<string>();
  for (const s of sheets) {
    const kind = s.role && ROLE_KIND[s.role] ? ROLE_KIND[s.role] : att.kind;
    for (const raw of tsvTrackings(s.tsv).trackings) {
      const t = cleanTracking(raw);
      const sheet = sheets.length > 1 ? s.name : null;
      const key = `${sheet ?? ''}|${t}`;
      if (!t || seen.has(key)) continue;
      seen.add(key);
      out.push({ inboxAttachmentId: att.id, sheet, unitKind: kind, unitConsNumber: kind === att.kind ? att.consNumber : null, trackingNumber: t });
    }
  }
  return out;
}

/** Guías DHL del cuerpo del correo (bloques "AWB : 1234567890"). */
export function guidesFromDhlBody(textBody: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(textBody ?? '').matchAll(/AWB\s*:\s*([0-9 ]{10,14})/gi)) {
    const t = cleanTracking(m[1]);
    if (t) out.add(t);
  }
  return [...out];
}
