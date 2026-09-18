import { IncomeSourceType } from '../common/enums/income-source-type.enum';
import { IncomeStatus } from '../common/enums/income-status.enum';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { Verdict } from './logic/package-verdict.util';

/** Fila del consolidador: un `income` enriquecido para la vista/edición. */
export interface ConsolidadorRow {
  id: string;
  trackingNumber: string | null;
  sourceType: IncomeSourceType;
  incomeType: IncomeStatus;
  cost: number;
  originalCost: number | null;
  date: string; // ISO
  consNumber: string | null;
  consolidatedId: string | null;
  routeId: string | null;
  shipmentId: string | null;
  shipmentStatus: ShipmentStatusType | null;
  editReason: string | null;
  /** Estado del 2º a bordo (solo relevante para cargas): true=incluido, false=quitado, null=nunca tocado. */
  secondAbordApplied: boolean | null;
  /** Monto del 2º a bordo de la sucursal (para desglosar el costo de la carga en la edición). */
  secondAbordAmount: number;
  /** Sucursal a la que pertenece el ingreso (para detectar/mover ingresos mal asignados). */
  subsidiaryId: string | null;
  subsidiaryName: string | null;
}

export interface ConsolidadorBucket {
  amount: number;
  count: number;
}

export interface ConsolidadorBuckets {
  envios: ConsolidadorBucket;
  cargas: ConsolidadorBucket;
  recolecciones: ConsolidadorBucket;
  traslados: ConsolidadorBucket;
  manual: ConsolidadorBucket;
  total: ConsolidadorBucket;
}

export interface ConsolidadorReadResult {
  rows: ConsolidadorRow[];
  buckets: ConsolidadorBuckets;
}

/** Fila de una tarjeta de ruta/consolidado: la fila de ingreso completa (para editar/historial) + veredicto. */
export interface ConsolidadorGroupRow {
  tracking: string | null;
  shipmentId: string | null;
  status: ShipmentStatusType | null;
  /** true = envío (cuenta como entrega y aplica veredicto); false = carga/recolección/etc. */
  isShipment: boolean;
  /** Fila de ingreso completa (null cuando el envío aún no tiene ingreso). */
  income: ConsolidadorRow | null;
  verdict: Verdict;
}

/** KPIs de una ruta/consolidado en la semana. */
export interface ConsolidadorGroupKpis {
  delivered: number;
  notDelivered: number;
  incomeAmount: number;
  incomeCount: number;
  chargeDiscrepancy: number;
  anomalyCount: number;
}

/** Una ruta o un consolidado de la semana con sus KPIs y el detalle de guías. */
export interface ConsolidadorGroup {
  id: string;
  label: string;
  date: string | null;
  meta: { driver?: string | null; owner?: string | null; shipmentCount: number };
  kpis: ConsolidadorGroupKpis;
  rows: ConsolidadorGroupRow[];
}

export interface ConsolidadorGroupsResult {
  groups: ConsolidadorGroup[];
}

/** Fila normalizada de entrada para agrupar (una por envío de la ruta/consolidado + una por carga con ingreso). */
export interface GroupInputRow {
  tracking: string | null;
  shipmentId: string | null;
  status: ShipmentStatusType | null;
  /** true = envío (cuenta como entrega/no-entrega y aplica veredicto); false = carga/recolección/etc. */
  isShipment: boolean;
  /** Fila de ingreso completa (null cuando el envío no tiene ingreso). */
  income: ConsolidadorRow | null;
  /** Clave del grupo ya resuelta por el caller (routeId/consNumber o sintética "Sin ruta"). */
  groupKey: string;
  groupLabel: string;
  groupDate: string | null;
  driver: string | null;
  owner: string | null;
  verdict: Verdict;
}
