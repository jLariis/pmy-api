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
