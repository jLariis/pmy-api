import { canonicalFedexExceptionCode } from './fedex-exception-code.util';
import { effectiveLocalDay, effectiveLocalDaySql } from './income-window.util';

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

/**
 * Solo FedEx: desde este día local (Hermosillo) un código SIN regla en `charge_rule` NO cobra; solo
 * cobran entregado, DEX07 y DEX08 3ra visita (2026-10-19). Antes cobraba por respaldo (84, 31, 14,
 * 08D… ~$68.8k) y se deja así para no mover semanas ya cerradas. Las demás paqueterías no cambian.
 */
export const NO_RULE_NOT_CHARGEABLE_FROM_DAY = '2026-10-19';
const NO_RULE_CUTOFF_CARRIER = 'fedex';

/** ¿Cobra un ingreso cuyo código no tiene regla? FedEx: solo antes del corte (sin fecha = histórico). */
export function noRuleFallback(income: { sourceType?: string | null; shipmentType?: string | null; date?: Date | string | null }): boolean {
  if (String(income.shipmentType ?? '').toLowerCase() !== NO_RULE_CUTOFF_CARRIER) return true;
  if (!income.date) return true;
  return effectiveLocalDay({ sourceType: income.sourceType, date: income.date }) < NO_RULE_NOT_CHARGEABLE_FROM_DAY;
}

/** Espejo SQL de `noRuleFallback` (1/0). */
export function noRuleFallbackSql(alias = 'income'): string {
  return `(CASE WHEN ${alias}.shipmentType <> '${NO_RULE_CUTOFF_CARRIER}' OR ${effectiveLocalDaySql(alias)} < '${NO_RULE_NOT_CHARGEABLE_FROM_DAY}' THEN 1 ELSE 0 END)`;
}

const TRANSFER_SOURCES = new Set(['tyco', 'aeropuerto', 'special_transfer']);

export interface CountableIncomeLike {
  sourceType?: string;
  incomeType?: string;
  nonDeliveryStatus?: string | null;
  /** Carrier del ingreso (ShipmentType: 'fedex' | 'dhl' | 'other'). */
  shipmentType?: string;
  /** Fecha del ingreso: decide el respaldo de códigos sin regla (`noRuleFallback`). */
  date?: Date | string | null;
}

/**
 * Resuelve si un (carrier, código) COBRA, según reglas global + override de sucursal.
 * Devuelve `undefined` cuando no hay regla definida → el lector aplica `noRuleFallback`.
 */
export interface ChargeableResolver {
  isChargeable(carrier: string, code: string): boolean | undefined;
}

export interface CountableOptions {
  /** ¿Los traslados (tyco/aeropuerto/especial) cuentan? (flag de sucursal). */
  countTransfers?: boolean;
  /** Reglas de cobro por estatus (charge_rule). Si falta → todo shipment/charge cuenta. */
  resolver?: ChargeableResolver;
  /** Monto del 2º a bordo de la sucursal, para desglosarlo (informativo) en el reporte de cargas. */
  secondAbordAmount?: number;
}

/** Código de cobro efectivo de un ingreso: 'DELIVERED' si entregado; si no, el código de no-entrega. */
export function effectiveChargeCode(income: CountableIncomeLike): string {
  const it = String(income.incomeType || '').toLowerCase();
  if (it === 'entregado') return DELIVERED_CODE;
  return canonicalFedexExceptionCode(String(income.nonDeliveryStatus ?? '').trim());
}

/**
 * ¿Este ingreso cuenta para el total?
 * - Traslados: cuentan si `countTransfers` (default true).
 * - Recolecciones: siempre cuentan.
 * - Envíos/cargas: según `charge_rule` para (carrier, código). Sin regla → `noRuleFallback`
 *   (FedEx: no cobra desde el corte). Sin resolver (no se cargaron reglas) → cuenta.
 * - manual ("Otro" del Consolidador sin guía): siempre cuenta — es una corrección capturada a
 *   mano y el usuario debe verla reflejada en Ingresos, Dashboard y Estado de Resultados.
 * - otros sourceType: NO cuentan.
 */
export function isCountableIncome(income: CountableIncomeLike, opts?: CountableOptions): boolean {
  const st = String(income.sourceType || '').toLowerCase();

  if (TRANSFER_SOURCES.has(st)) return opts?.countTransfers ?? true;
  if (st === 'collection' || st === 'manual') return true;

  if (st === 'shipment' || st === 'charge') {
    const carrier = String(income.shipmentType || '').toLowerCase();
    const code = effectiveChargeCode(income);
    if (!opts?.resolver) return true;
    return opts.resolver.isChargeable(carrier, code) ?? noRuleFallback(income);
  }

  return false;
}
