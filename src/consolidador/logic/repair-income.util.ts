import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

const DELIVERED = [
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
];

const NOT_DELIVERED_CHARGEABLE = [
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
];

/**
 * Decide si un shipment SIN ingreso activo debería generar uno (reparación) según su estatus, y de
 * qué tipo. Solo estatus terminales/cobrables crean ingreso; los estatus en tránsito no (el ingreso
 * de un envío nace al resolverse, típicamente en el cierre de ruta). La chargeabilidad final la
 * decide `charge_rule` en los reportes; aquí solo mapeamos estatus → incomeType.
 */
export function deriveRepairIncome(
  status: ShipmentStatusType | null,
): { create: boolean; incomeType: IncomeStatus | null } {
  if (status && DELIVERED.includes(status)) return { create: true, incomeType: IncomeStatus.ENTREGADO };
  if (status && NOT_DELIVERED_CHARGEABLE.includes(status)) {
    return { create: true, incomeType: IncomeStatus.NO_ENTREGADO };
  }
  return { create: false, incomeType: null };
}
