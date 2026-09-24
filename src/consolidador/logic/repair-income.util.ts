import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';
import { ShipmentType } from '../../common/enums/shipment-type.enum';
import { hermosilloDayStartFromInstant } from '../../common/utils';
import { warehouseDeliveryCost, warehouseDeliveryIncomeAction } from '../../pick-up/warehouse-delivery-income.util';

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

export interface RepairIncomeInput {
  status: ShipmentStatusType | null;
  /** Instante de la entrega en bodega (warehouse_delivery.date), si la hubo. */
  warehouseDeliveredAt: Date | null;
  /** Ingresos ACTIVOS de envío de la guía. */
  existingActive: { id: string; incomeType: IncomeStatus | string }[];
  shipmentType: ShipmentType | string | null | undefined;
  subsidiary: { fedexCostPackage?: number | null; dhlCostPackage?: number | null } | null | undefined;
}

export interface RepairIncomePlan {
  action: 'create' | 'supersede' | 'none';
  incomeType: IncomeStatus | null;
  incomeId?: string; // supersede: el DEX a reemplazar
  date: Date | null; // null = "ahora" (comportamiento de siempre fuera de bodega)
  cost: number;
  reason?: string; // por qué no se hace nada
}

/**
 * Plan de reparación de ingreso de un envío. Entregado en bodega sigue la MISMA regla que el
 * alta de pick-up (warehouseDeliveryIncomeAction): crea ENTREGADO, o reemplaza el DEX de una
 * visita previa, fechado al día Hermosillo de la entrega y con el costo del carrier. El resto
 * de estatus conserva el comportamiento de siempre (deriveRepairIncome, sin tocar ingresos).
 */
export function planRepairIncome(input: RepairIncomeInput): RepairIncomePlan {
  const cost = warehouseDeliveryCost(input.shipmentType, input.subsidiary);
  const isWarehouse = !!input.warehouseDeliveredAt || input.status === ShipmentStatusType.ENTREGADO_EN_BODEGA;

  if (isWarehouse) {
    const action = warehouseDeliveryIncomeAction(input.existingActive);
    const date = hermosilloDayStartFromInstant(input.warehouseDeliveredAt ?? new Date());
    if (action.type === 'none') {
      return { action: 'none', incomeType: null, date: null, cost, reason: 'El paquete ya tiene su ingreso de entregado' };
    }
    return action.type === 'supersede'
      ? { action: 'supersede', incomeId: action.incomeId, incomeType: IncomeStatus.ENTREGADO, date, cost }
      : { action: 'create', incomeType: IncomeStatus.ENTREGADO, date, cost };
  }

  if (input.existingActive.length) {
    return { action: 'none', incomeType: null, date: null, cost, reason: 'El paquete ya tiene un ingreso activo' };
  }
  const { create, incomeType } = deriveRepairIncome(input.status);
  if (!create || !incomeType) {
    return { action: 'none', incomeType: null, date: null, cost, reason: 'El estatus del paquete no genera ingreso (no es cobrable/terminal)' };
  }
  return { action: 'create', incomeType, date: null, cost: Number(input.subsidiary?.fedexCostPackage ?? 0) };
}
