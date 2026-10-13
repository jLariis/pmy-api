import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

export type ManualKind = 'recoleccion' | 'pod' | 'dex' | 'manual';

/** Mapea el tipo de alta manual a (sourceType, incomeType) y normaliza el costo. */
export function resolveManualIncomeCost(
  kind: ManualKind,
  overrides: { cost?: number },
): { cost: number; sourceType: IncomeSourceType; incomeType: IncomeStatus } {
  const cost = Number((overrides.cost ?? 0).toFixed(2));
  switch (kind) {
    case 'recoleccion':
      return { cost, sourceType: IncomeSourceType.COLLECTION, incomeType: IncomeStatus.ENTREGADO };
    case 'pod':
      return { cost, sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.ENTREGADO };
    case 'dex':
      return { cost, sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.CLIENTE_NO_DISPONIBLE_3RA_VISITA };
    case 'manual':
      return { cost, sourceType: IncomeSourceType.MANUAL, incomeType: IncomeStatus.ENTREGADO };
  }
}

export interface LinkedManualIncome {
  cost: number;
  sourceType: IncomeSourceType;
  incomeType: IncomeStatus;
  /** Registro (shipment) de la guía al que queda ligado el ingreso; null si no aplica. */
  shipmentId: string | null;
  /** Carrier de la guía ligada; null = el que ya traiga el alta. */
  shipmentType: string | null;
}

/**
 * Liga un alta manual con guía al registro de esa guía. Un ingreso `manual` NO cuenta en
 * ningún reporte (isCountableIncome), así que "Manual (otro)" con una guía que existe se guarda
 * como ingreso de la guía (sourceType=shipment), igual que uno automático: suma en dashboard,
 * Excel y Finanzas→Ingresos. POD/DEX también se ligan. Recolección y manual sin guía no cambian.
 * Caso 878249671370 (Hermosillo, 10-oct-2026).
 */
export function linkManualIncomeToShipment(
  base: { cost: number; sourceType: IncomeSourceType; incomeType: IncomeStatus },
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
