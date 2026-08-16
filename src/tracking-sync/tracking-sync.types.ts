import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Shipment } from 'src/entities/shipment.entity';

/** Referencia mínima para consultar un carrier. */
export interface TrackingRef {
  trackingNumber: string;
  fedexUniqueId?: string;
  carrierCode?: string;
}

/** Resultado crudo del carrier. El Source ya eligió la generación → `trackResults: [winner]`. */
export interface RawTrackingResult {
  trackingNumber: string;
  trackResults: any[];
}

/** Evento normalizado, carrier-agnóstico. */
export interface NormalizedEvent {
  occurredAt: Date;
  derivedCode: string | null;
  statusCode: string | null;
  exceptionCode: string | null;
  eventType: string | null;
  description: string | null;
  location: string | null;
  status: ShipmentStatusType;
  /** Clave determinista final (para el cutover: dedup en shipment_status). */
  eventKey: string;
  /** Clave reconstruible desde columnas existentes de shipment_status (para shadow). */
  shadowKey: string;
}

export interface StatusValidation {
  ok: boolean;
  issues: string[];
}

export interface NormalizedTracking {
  trackingNumber: string;
  /** Ordenados ascendente por `occurredAt`. */
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
  commitDateTime: Date | null;
  validation: StatusValidation;
}

export interface ReconcileResult {
  /** Eventos cuya clave no está en el set conocido (asc por fecha). */
  newEvents: NormalizedEvent[];
  proposedStatus: ShipmentStatusType | null;
  currentStatus: ShipmentStatusType;
  transition: { from: ShipmentStatusType; to: ShipmentStatusType } | null;
}

/** Side-effect encolado por una regla; NUNCA se ejecuta dentro de la regla. */
export interface DeferredEffect {
  type: string;
  payload: Record<string, any>;
}

/** Estado mutable que atraviesa el pipeline de reglas. */
export interface SyncContext {
  shipment: Shipment;
  normalized: NormalizedTracking;
  reconcile: ReconcileResult;
  proposedStatus: ShipmentStatusType | null;
  vetoedEventKeys: Set<string>;
  deferredEffects: DeferredEffect[];
  notes: string[];
}

export interface SyncRule {
  readonly name: string;
  readonly priority: number; // mayor = corre primero
  apply(ctx: SyncContext): void | Promise<void>;
}

export interface SinkOutcome {
  shipmentId: string;
  trackingNumber: string;
  proposedStatus: ShipmentStatusType | null;
  wouldInsertEvents: number;
  matchesLegacy: boolean;
}

export interface SyncSink {
  applyPlan(ctx: SyncContext, runId: string): Promise<SinkOutcome>;
}

export interface TrackingSource {
  fetch(refs: TrackingRef[]): Promise<RawTrackingResult[]>;
}

/** Token DI para inyectar el array de reglas. */
export const SYNC_RULES = Symbol('SYNC_RULES');
