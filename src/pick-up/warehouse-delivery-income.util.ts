import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';

export type WarehouseDeliveryIncomeAction =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'supersede'; incomeId: string };

/**
 * "Entregado en bodega" es una entrega final (igual que un POD del cierre de ruta), así que el
 * envío debe cobrar como ENTREGADO. Con los ingresos ACTIVOS (sourceType=shipment) de la guía:
 *  - ya hay un ENTREGADO → nada (no duplicar)
 *  - hay un no-entregado (DEX de una visita previa) → se reemplaza por ENTREGADO
 *  - no hay ninguno → se crea
 */
export function warehouseDeliveryIncomeAction(
  existingActive: { id: string; incomeType: IncomeStatus | string }[],
): WarehouseDeliveryIncomeAction {
  if (existingActive.some((i) => i.incomeType === IncomeStatus.ENTREGADO)) return { type: 'none' };
  const dex = existingActive.find((i) => i.incomeType === IncomeStatus.NO_ENTREGADO);
  if (dex) return { type: 'supersede', incomeId: dex.id };
  return { type: 'create' };
}

/** Costo por paquete según carrier (mismo criterio que el cierre de ruta). */
export function warehouseDeliveryCost(
  shipmentType: ShipmentType | string | null | undefined,
  subsidiary: { fedexCostPackage?: number | null; dhlCostPackage?: number | null } | null | undefined,
): number {
  const raw = shipmentType === ShipmentType.DHL ? subsidiary?.dhlCostPackage : subsidiary?.fedexCostPackage;
  return Number(raw ?? 0);
}
