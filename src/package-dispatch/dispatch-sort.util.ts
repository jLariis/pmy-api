/**
 * Orden de las salidas a ruta. Espejo de `lib/tracking/sort-by-zip.ts` (app-pmy):
 * mantener ambos en sync para que pantalla, PDF y Excel salgan en el mismo orden.
 *
 *  - 'carrier_cp': paquetería (FedEx —incluye F2— y luego DHL) → CP → dirección.
 *  - 'cp': CP → dirección (mezcla paqueterías).
 *  - 'scan': orden en que se escanearon.
 */
export type DispatchSortMode = 'carrier_cp' | 'cp' | 'scan';

export const DISPATCH_SORT_MODES: DispatchSortMode[] = ['carrier_cp', 'cp', 'scan'];

export interface DispatchSortable {
  recipientZip?: string | null;
  recipientAddress?: string | null;
  shipmentType?: string | null;
  isCharge?: boolean;
}

export type DispatchCarrier = 'fedex' | 'dhl' | 'other';

/** Paquetería del paquete: las cargas (F2) son FedEx. */
export function dispatchCarrier(p: DispatchSortable): DispatchCarrier {
  const t = String(p?.shipmentType ?? '').toLowerCase();
  if (t === 'dhl') return 'dhl';
  if (t === 'fedex' || p?.isCharge) return 'fedex';
  return 'other';
}

const CARRIER_RANK: Record<DispatchCarrier, number> = { fedex: 0, dhl: 1, other: 2 };

/** CP numérico ascendente (sin CP al final) y, a igual CP, dirección A→Z. */
export function compareByZip(a: DispatchSortable, b: DispatchSortable): number {
  const za = (a?.recipientZip ?? '').toString().trim();
  const zb = (b?.recipientZip ?? '').toString().trim();
  if (za || zb) {
    if (!za) return 1;
    if (!zb) return -1;
    const na = Number(za);
    const nb = Number(zb);
    const zipCmp = !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : za.localeCompare(zb);
    if (zipCmp !== 0) return zipCmp;
  }
  const aa = (a?.recipientAddress ?? '').toString().trim();
  const ab = (b?.recipientAddress ?? '').toString().trim();
  if (!aa && !ab) return 0;
  if (!aa) return 1;
  if (!ab) return -1;
  return aa.localeCompare(ab, 'es', { numeric: true, sensitivity: 'base' });
}

export function compareByCarrierThenZip(a: DispatchSortable, b: DispatchSortable): number {
  const c = CARRIER_RANK[dispatchCarrier(a)] - CARRIER_RANK[dispatchCarrier(b)];
  return c !== 0 ? c : compareByZip(a, b);
}

/** Modo por defecto de la sucursal (la paquetería manda sobre el CP). */
export function subsidiaryDispatchSortMode(sub?: {
  sortDispatchByCarrier?: boolean | null;
  sortDispatchByPostalCode?: boolean | null;
} | null): DispatchSortMode {
  if (sub?.sortDispatchByCarrier) return 'carrier_cp';
  if (sub?.sortDispatchByPostalCode) return 'cp';
  return 'scan';
}

export function isDispatchSortMode(v: unknown): v is DispatchSortMode {
  return typeof v === 'string' && (DISPATCH_SORT_MODES as string[]).includes(v);
}

/** Copia ordenada según el modo (no muta). */
export function sortForDispatch<T extends DispatchSortable>(items: T[] = [], mode: DispatchSortMode): T[] {
  if (mode === 'carrier_cp') return [...items].sort(compareByCarrierThenZip);
  if (mode === 'cp') return [...items].sort(compareByZip);
  return [...items];
}
