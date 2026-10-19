/**
 * Piezas puras del expediente de una guía (búsqueda interna). Sin BD para poder probarlas.
 */

/** Variantes a buscar: el texto limpio y, en DHL, la pareja JJD↔JD. */
export function buildQueryVariants(raw: string): string[] {
  const q = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!q) return [];
  const variants = [q];
  if (q.startsWith('JJD')) variants.push(q.substring(1));
  else if (q.startsWith('JD')) variants.push('J' + q);
  return variants;
}

/**
 * Notas que escribe el propio sistema en shipment_status. Esas filas son movimientos internos
 * (ya salen de sus tablas) y no deben aparecer en el historial FedEx/DHL.
 */
const INTERNAL_NOTE_PATTERNS: RegExp[] = [
  /^registro inicial/i,
  /^ingreso a bodega mediante desembarque/i,
  /^salida a ruta/i,
  /confirmado en inventario f[ií]sico/i,
  /^cargado desde archivo f2/i,
  /^transferencia en ruta/i,
  /^cambio de tipo/i,
  /^entrega sin efecto/i,
  /^devoluci[oó]n registrada/i,
];

export function isInternalStatusNote(notes?: string | null): boolean {
  const n = (notes ?? '').trim();
  if (!n) return false;
  return INTERNAL_NOTE_PATTERNS.some((re) => re.test(n));
}

export interface RawStatusRow {
  status: string;
  exceptionCode?: string | null;
  notes?: string | null;
  timestamp?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface CarrierEvent {
  date: string | null;
  status: string;
  code: string | null;
  description: string | null;
}

const toIso = (d?: Date | string | null): string | null => {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/** Historial FedEx/DHL: filas de shipment_status sin las internas, del más reciente al más viejo. */
export function buildCarrierEvents(rows: RawStatusRow[]): CarrierEvent[] {
  return rows
    .filter((r) => !isInternalStatusNote(r.notes))
    .map((r) => ({
      date: toIso(r.timestamp ?? r.createdAt),
      status: r.status,
      code: r.exceptionCode?.trim() || null,
      description: r.notes?.trim() || null,
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export type InternalEventKind =
  | 'registro'
  | 'desembarque'
  | 'salida_ruta'
  | 'ingreso'
  | 'inventario'
  | 'devolucion';

export interface InternalEvent {
  kind: InternalEventKind;
  /** Instante para ordenar (y mostrar con hora). */
  date: string | null;
  /** Si viene, el evento es de día (ingresos): se muestra solo este día 'YYYY-MM-DD'. */
  day?: string | null;
  title: string;
  detail: string | null;
  /** Etiqueta corta del resultado (cierre de ruta, ingreso anulado, devolución deshecha…). */
  tag: string | null;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

/** Orden cronológico (más viejo primero, como se vive el paquete); sin fecha al final. */
export function sortInternalEvents(events: InternalEvent[]): InternalEvent[] {
  return [...events].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

/** Nombre legible de un usuario o null. */
export function userLabel(u?: { name?: string | null; lastName?: string | null; email?: string | null } | null): string | null {
  if (!u) return null;
  const full = [u.name, u.lastName].filter(Boolean).join(' ').trim();
  return full || u.email || null;
}

/** Clave de pieza: en DHL la pieza (JD) es lo que identifica el paquete físico. */
export function pieceKey(r: { trackingNumber: string; dhlUniqueId?: string | null }): string {
  return r.dhlUniqueId || r.trackingNumber;
}
