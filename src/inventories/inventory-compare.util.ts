/**
 * Comparación entre dos inventarios de la misma sucursal (detalle de Operaciones → Inventarios):
 * qué guías ya no están, cuáles aparecieron y cuáles siguen. La identidad de un paquete es la
 * pieza (`dhlUniqueId`) o, si no hay, la guía — igual que el resto de la app (pieceKey).
 */
export interface InventoryPackageRow {
  id: string;
  trackingNumber: string;
  dhlUniqueId?: string | null;
  recipientName?: string | null;
  recipientZip?: string | null;
  status?: string | null;
  isCharge?: boolean | number | null;
  recipientAddress?: string | null;
  recipientCity?: string | null;
  commitDateTime?: Date | string | null;
  /** "COD $350" si tiene cobro. */
  paymentLabel?: string | null;
}

export const inventoryPackageKey = (p: { trackingNumber?: string | null; dhlUniqueId?: string | null }): string =>
  String(p.dhlUniqueId || p.trackingNumber || '').trim().toUpperCase();

export function diffInventories(previous: InventoryPackageRow[], current: InventoryPackageRow[]) {
  const prevKeys = new Map<string, InventoryPackageRow>();
  for (const p of previous) {
    const k = inventoryPackageKey(p);
    if (k && !prevKeys.has(k)) prevKeys.set(k, p);
  }
  const currKeys = new Set<string>();
  const appeared: string[] = [];
  const kept: string[] = [];
  for (const p of current) {
    const k = inventoryPackageKey(p);
    if (!k || currKeys.has(k)) continue;
    currKeys.add(k);
    (prevKeys.has(k) ? kept : appeared).push(k);
  }
  const gone = [...prevKeys.entries()]
    .filter(([k]) => !currKeys.has(k))
    .map(([, p]) => ({
      ...p,
      dhlUniqueId: p.dhlUniqueId ?? null,
      recipientName: p.recipientName ?? null,
      recipientZip: p.recipientZip ?? null,
      status: p.status ?? null,
      isCharge: !!Number(p.isCharge ?? 0),
    }));
  return { gone, appearedKeys: appeared, keptKeys: kept };
}

/**
 * Grupo de una guía que YA NO ESTÁ en el inventario (estaba en el anterior del mismo día), según
 * su estatus de hoy y si tuvo movimiento real desde el inventario anterior (las confirmaciones de
 * inventario no cuentan, ver inventory-movement.util):
 *   sinMovimiento  sigue "en bodega/pendiente" y no pasó nada → hay que buscarla
 *   bodega         sigue en bodega/pendiente pero tuvo algún movimiento → revisar el conteo
 *   dex | ruta | pod | otros (devuelta, ocurre, a cargo de FedEx…)
 */
export type InventoryGoneBucket = 'sinMovimiento' | 'bodega' | 'dex' | 'ruta' | 'pod' | 'otros';

export const INVENTORY_GONE_BUCKETS: InventoryGoneBucket[] = ['sinMovimiento', 'bodega', 'dex', 'ruta', 'pod', 'otros'];

const POD = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega']);
const ROUTE = new Set(['en_ruta', 'en_transito']);
const WAREHOUSE = new Set(['en_bodega', 'pendiente', 'recibido_en_bodega', 'llegado_despues', 'desconocido', 'recoleccion', '']);
const DEX = new Set([
  'direccion_incorrecta', 'restriccion_seguridad_ubicacion', 'rechazado', 'cliente_no_disponible',
  'cambio_fecha_solicitado', 'empresa_cerrada', 'demora_en_entrega', 'no_se_pudo_recolectar_el_cobro',
  'no_entregado', 'otro', 'dex03', 'dex07', 'dex08', 'cambio_domicilio',
]);

export function inventoryGoneBucket(status: string | null | undefined, movedSincePrevious: boolean): InventoryGoneBucket {
  const st = String(status ?? '').trim().toLowerCase();
  if (POD.has(st)) return 'pod';
  if (ROUTE.has(st)) return 'ruta';
  if (DEX.has(st)) return 'dex';
  if (WAREHOUSE.has(st)) return movedSincePrevious ? 'bodega' : 'sinMovimiento';
  return 'otros';
}

export type InventoryGoneCounts = Record<InventoryGoneBucket, number>;

export const emptyGoneCounts = (): InventoryGoneCounts => ({ sinMovimiento: 0, bodega: 0, dex: 0, ruta: 0, pod: 0, otros: 0 });
