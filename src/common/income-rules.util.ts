/**
 * Regla ÚNICA de "qué ingreso cuenta" — la usan los 3 lectores (tabla de
 * ingresos, dashboard financiero y KPIs) para que todas las pantallas cuadren.
 * Las reglas viven por sucursal (entidad Subsidiary). Defaults = comportamiento
 * histórico (DEX03 no cuenta pero el registro se conserva; el resto sí).
 */
export interface IncomeCountRules {
  chargeDex03?: boolean;
  chargeDex07?: boolean;
  chargeDex08?: boolean;
  chargeDelivered?: boolean;
  countTransfersAsIncome?: boolean;
}

export const DEFAULT_INCOME_RULES: Required<IncomeCountRules> = {
  chargeDex03: false,
  chargeDex07: true,
  chargeDex08: true,
  chargeDelivered: true,
  countTransfersAsIncome: true,
};

const TRANSFER_SOURCES = new Set(['tyco', 'aeropuerto', 'special_transfer']);

export interface CountableIncomeLike {
  sourceType?: string;
  incomeType?: string;
  nonDeliveryStatus?: string | null;
}

/**
 * ¿Este ingreso cuenta para el total, según las reglas de la sucursal?
 * - Traslados (tyco/aeropuerto/especial): cuentan si `countTransfersAsIncome`.
 * - Recolecciones: siempre cuentan.
 * - Envíos/cargas: por estatus → entregado (chargeDelivered), no_entregado 03/07/08
 *   según su flag (independiente del transportista), otros estatus cuentan.
 * - manual u otros sourceType: NO cuentan (preserva el comportamiento previo).
 */
export function isCountableIncome(income: CountableIncomeLike, rules?: IncomeCountRules): boolean {
  const r = { ...DEFAULT_INCOME_RULES, ...(rules || {}) };
  const st = String(income.sourceType || '').toLowerCase();

  if (TRANSFER_SOURCES.has(st)) return !!r.countTransfersAsIncome;
  if (st === 'collection') return true;

  if (st === 'shipment' || st === 'charge') {
    const it = String(income.incomeType || '').toLowerCase();
    const code = income.nonDeliveryStatus ?? '';
    if (it === 'entregado') return !!r.chargeDelivered;
    if (it === 'no_entregado') {
      if (code === '03') return !!r.chargeDex03;
      if (code === '07') return !!r.chargeDex07;
      if (code === '08') return !!r.chargeDex08;
      return true;
    }
    return true;
  }

  return false;
}
