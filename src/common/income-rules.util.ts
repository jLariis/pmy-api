/**
 * Regla ÚNICA de "qué ingreso cuenta" — la usan los lectores (tabla de ingresos,
 * dashboard financiero y KPIs) para que todas las pantallas cuadren.
 *
 * El cobro por ESTATUS ahora vive en la tabla `charge_rule` (por carrier + código,
 * global + override por sucursal). Ver `ChargeableResolver`. Los traslados y
 * recolecciones conservan su lógica propia (flag de sucursal / siempre cuentan).
 */

/** Pseudo-código para el estatus "entregado" en las reglas de cobro. */
export const DELIVERED_CODE = 'DELIVERED';

const TRANSFER_SOURCES = new Set(['tyco', 'aeropuerto', 'special_transfer']);

export interface CountableIncomeLike {
  sourceType?: string;
  incomeType?: string;
  nonDeliveryStatus?: string | null;
  /** Carrier del ingreso (ShipmentType: 'fedex' | 'dhl' | 'other'). */
  shipmentType?: string;
}

/**
 * Resuelve si un (carrier, código) COBRA, según reglas global + override de sucursal.
 * Devuelve `undefined` cuando no hay regla definida → el lector aplica el fallback
 * histórico (`true`, equivalente al `ELSE 1` del espejo SQL).
 */
export interface ChargeableResolver {
  isChargeable(carrier: string, code: string): boolean | undefined;
}

export interface CountableOptions {
  /** ¿Los traslados (tyco/aeropuerto/especial) cuentan? (flag de sucursal). */
  countTransfers?: boolean;
  /** Reglas de cobro por estatus (charge_rule). Si falta → todo shipment/charge cuenta. */
  resolver?: ChargeableResolver;
}

/** Código de cobro efectivo de un ingreso: 'DELIVERED' si entregado; si no, el código de no-entrega. */
export function effectiveChargeCode(income: CountableIncomeLike): string {
  const it = String(income.incomeType || '').toLowerCase();
  if (it === 'entregado') return DELIVERED_CODE;
  return String(income.nonDeliveryStatus ?? '').trim();
}

/**
 * ¿Este ingreso cuenta para el total?
 * - Traslados: cuentan si `countTransfers` (default true).
 * - Recolecciones: siempre cuentan.
 * - Envíos/cargas: según `charge_rule` para (carrier, código). Sin regla → cuenta.
 * - manual u otros sourceType: NO cuentan (preserva el comportamiento previo).
 */
export function isCountableIncome(income: CountableIncomeLike, opts?: CountableOptions): boolean {
  const st = String(income.sourceType || '').toLowerCase();

  if (TRANSFER_SOURCES.has(st)) return opts?.countTransfers ?? true;
  if (st === 'collection') return true;

  if (st === 'shipment' || st === 'charge') {
    const carrier = String(income.shipmentType || '').toLowerCase();
    const code = effectiveChargeCode(income);
    const resolved = opts?.resolver?.isChargeable(carrier, code);
    return resolved ?? true; // fallback histórico: cuenta
  }

  return false;
}
