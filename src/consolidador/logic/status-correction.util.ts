import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

export type IncomeEffect =
  | { kind: 'none' }
  | { kind: 'reclassify'; incomeType: IncomeStatus }
  | { kind: 'setCost'; cost: number }
  | { kind: 'deactivate' };

const NO_ENTREGADO_TERMINAL = [ShipmentStatusType.RECHAZADO, ShipmentStatusType.DEVUELTO_A_FEDEX];

/**
 * Regla acotada v1: dado el estatus interno actual y el canónico de FedEx, decide el nuevo
 * estatus del shipment y el efecto sobre el income ligado.
 *  - Sin dato de FedEx o sin diferencia → no toca nada.
 *  - FedEx entregado (y el interno no) → estatus entregado + income reclasificado a `entregado`.
 *  - FedEx rechazado / devuelto a FedEx → ese estatus + income reclasificado a `no_entregado`.
 *  - Cualquier otra diferencia → solo corrige el estatus, income intacto.
 */
export function deriveStatusCorrection(
  current: ShipmentStatusType | null,
  fedex: ShipmentStatusType | null,
): { newStatus: ShipmentStatusType | null; incomeEffect: IncomeEffect } {
  if (!fedex || fedex === current) return { newStatus: current, incomeEffect: { kind: 'none' } };
  if (fedex === ShipmentStatusType.ENTREGADO) {
    return { newStatus: fedex, incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.ENTREGADO } };
  }
  if (NO_ENTREGADO_TERMINAL.includes(fedex)) {
    return { newStatus: fedex, incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.NO_ENTREGADO } };
  }
  return { newStatus: fedex, incomeEffect: { kind: 'none' } };
}
