import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

export type ManualKind = 'recoleccion' | 'pod' | 'dex' | 'dex07' | 'manual';

/** Código FedEx del DEX que se captura a mano (3ª visita, cliente no disponible). */
export const MANUAL_DEX_CODE = '08';
/** Código FedEx del rechazo (DEX07) que se captura a mano. */
export const MANUAL_DEX07_CODE = '07';

export interface ResolvedManualIncome {
  cost: number;
  sourceType: IncomeSourceType;
  incomeType: IncomeStatus;
  /** Código de no entrega; '' cuando el ingreso es entregado/recolección/otro. */
  nonDeliveryStatus: string;
}

/**
 * Mapea el tipo de alta manual a (sourceType, incomeType, código) y normaliza el costo.
 * El DEX se guarda IGUAL que el automático (`no_entregado` + '08'): así lo cobra la regla de
 * cobro (charge_rule) y entra en el conteo de DEX08. Antes se guardaba como
 * `cliente_no_disponible_3ra_visita` sin código y, en FedEx, dejaba de sumar desde el 19-oct-2026.
 */
export function resolveManualIncomeCost(kind: ManualKind, overrides: { cost?: number }): ResolvedManualIncome {
  const cost = Number((overrides.cost ?? 0).toFixed(2));
  switch (kind) {
    case 'recoleccion':
      return { cost, sourceType: IncomeSourceType.COLLECTION, incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: '' };
    case 'pod':
      return { cost, sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: '' };
    case 'dex':
      return { cost, sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: MANUAL_DEX_CODE };
    case 'dex07':
      return { cost, sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: MANUAL_DEX07_CODE };
    case 'manual':
      return { cost, sourceType: IncomeSourceType.MANUAL, incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: '' };
  }
}

export interface LinkedManualIncome extends ResolvedManualIncome {
  /** Registro (shipment) de la guía al que queda ligado el ingreso; null si no aplica. */
  shipmentId: string | null;
  /** Carrier de la guía ligada; null = el que ya traiga el alta. */
  shipmentType: string | null;
}

/**
 * Liga un alta manual con guía al registro de esa guía. "Manual (otro)" con una guía que existe
 * se guarda como ingreso de la guía (sourceType=shipment), igual que uno automático: suma en su
 * columna de paquetería. POD/DEX también se ligan. Recolección y "Otro" sin guía no cambian
 * ("Otro" sin guía suma en la columna Otros). Caso 878249671370 (Hermosillo, 10-oct-2026).
 */
export function linkManualIncomeToShipment(
  base: ResolvedManualIncome,
  shipment: { id: string; shipmentType?: string | null } | null,
): LinkedManualIncome {
  const linkable = base.sourceType === IncomeSourceType.MANUAL || base.sourceType === IncomeSourceType.SHIPMENT;
  if (!shipment || !linkable) return { ...base, shipmentId: null, shipmentType: null };
  return {
    ...base,
    sourceType: IncomeSourceType.SHIPMENT,
    shipmentId: shipment.id,
    shipmentType: shipment.shipmentType ?? null,
  };
}
