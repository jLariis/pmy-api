import { IncomeSourceType } from '../common/enums/income-source-type.enum';
import { IncomeStatus } from '../common/enums/income-status.enum';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';

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
