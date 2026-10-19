import { LdState } from '../common/ld-rule.util';

export type PackageSummary = {
  delivered: number;
  inRoute: number;
  /** DEX vigentes por código ('03', '07', '08'…; 'otro' si no se conoce). */
  dex: Record<string, number>;
  returned: number;
  inWarehouse: number;
  inInventory: number;
  possibleLd: number;
  missingUnloading: number;
};

export type PackageRow = { status: string; exceptionCode: string | null; unloaded: boolean; inTodayInventory: boolean; ld: LdState };

const DELIVERED = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega']);
const RETURNED = new Set(['devuelto_a_fedex', 'retorno_abandono_fedex']);
const IN_ROUTE = new Set(['en_ruta', 'en_transito']);
const IN_WAREHOUSE = new Set(['en_bodega', 'pendiente', 'recibido_en_bodega', 'llegado_despues']);

/** Estatus DEX (no entregado en ruta) con su código FedEx cuando el estatus lo implica. */
const DEX_CODE: Record<string, string> = {
  direccion_incorrecta: '03',
  restriccion_seguridad_ubicacion: '05',
  rechazado: '07',
  cliente_no_disponible: '08',
  cambio_fecha_solicitado: '17',
  empresa_cerrada: '42',
  demora_en_entrega: '84',
  no_se_pudo_recolectar_el_cobro: '93',
  no_entregado: 'otro',
  otro: 'otro',
};

export const isDexStatus = (status: string | null | undefined) => String(status ?? '').toLowerCase() in DEX_CODE;

export function dexCodeOf(status: string, exceptionCode: string | null): string {
  const code = String(exceptionCode ?? '').trim();
  return code || DEX_CODE[String(status).toLowerCase()] || 'otro';
}

/** Resumen de los paquetes de un consolidado para las tarjetas del detalle. */
export function summarizePackages(rows: PackageRow[]): PackageSummary {
  const s: PackageSummary = { delivered: 0, inRoute: 0, dex: {}, returned: 0, inWarehouse: 0, inInventory: 0, possibleLd: 0, missingUnloading: 0 };
  for (const r of rows) {
    const st = String(r.status ?? '').toLowerCase();
    if (DELIVERED.has(st)) s.delivered++;
    else if (RETURNED.has(st)) s.returned++;
    else if (IN_ROUTE.has(st)) s.inRoute++;
    else if (isDexStatus(st)) {
      const code = dexCodeOf(st, r.exceptionCode);
      s.dex[code] = (s.dex[code] ?? 0) + 1;
    } else if (IN_WAREHOUSE.has(st)) s.inWarehouse++;
    if (r.inTodayInventory) s.inInventory++;
    if (r.ld === 'possible_ld') s.possibleLd++;
    if (!r.unloaded && !DELIVERED.has(st) && !RETURNED.has(st)) s.missingUnloading++;
  }
  return s;
}
