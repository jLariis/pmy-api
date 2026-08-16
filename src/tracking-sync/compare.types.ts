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
  skippedReason?: string;
  error?: string;
}
