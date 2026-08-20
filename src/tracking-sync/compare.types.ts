import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

export interface NormalizedEventDto {
  occurredAt: string; // ISO
  status: ShipmentStatusType;
  derivedCode: string | null;
  exceptionCode: string | null;
  description: string | null;
  location: string | null;
}

export interface CompareResult {
  shipmentId: string;
  /** 'shipment' = normal; 'charge' = F2/carga. */
  kind: 'shipment' | 'charge';
  trackingNumber: string;
  ourStatus: ShipmentStatusType;
  ourLastEventAt: string | null;
  fedexStatus: ShipmentStatusType | null;
  fedexLastEventAt: string | null;
  diverges: boolean;
  isStale: boolean;
  missingEvents: NormalizedEventDto[];
  fedexEvents: NormalizedEventDto[];
  issues: string[];
  error?: string;
}

export interface ApplyOutcome {
  shipmentId: string;
  trackingNumber: string;
  applied: boolean;
  fromStatus: ShipmentStatusType;
  toStatus: ShipmentStatusType | null;
  insertedEvents: number;
  /** 'shipment' = normal; 'charge' = F2/carga. Necesario para reglas que solo aplican a shipment. */
  kind?: 'shipment' | 'charge';
  /** exceptionCode del último evento FedEx normalizado (para decidir el ingreso en el cierre). */
  exceptionCode?: string | null;
  /** ISO del último evento FedEx normalizado (para anclar la fecha/ día del ingreso). */
  eventAt?: string | null;
  skippedReason?: string;
  error?: string;
}
