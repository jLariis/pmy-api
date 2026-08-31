import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';

/** Algo rastreable: envío normal (Shipment) o carga/F2 (ChargeShipment). */
export type Trackable = Shipment | ChargeShipment;
/** Discriminador: 'shipment' = normal; 'charge' = F2/carga. */
export type TrackableKind = 'shipment' | 'charge';
/** Entidad rastreable + su tipo, para el motor genérico. */
export interface TrackableItem {
  kind: TrackableKind;
  entity: Trackable;
}

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

/** Datos del ENCABEZADO de FedEx (latestStatusDetail + trackingNumberInfo + deliveryDetails). */
export interface TrackingHeader {
  code: string | null;            // latestStatusDetail.code
  derivedCode: string | null;     // latestStatusDetail.derivedCode
  ancillaryReason: string | null; // ancillaryDetails[0].reason (p.ej. '44')
  isDeliveredHeader: boolean;     // code/derivedCode === 'DL'
  actualDeliveryAt: Date | null;  // dateAndTimes ACTUAL_DELIVERY
  receivedByName: string | null;
  uniqueId: string | null;        // trackingNumberInfo.trackingNumberUniqueId
  carrierCode: string | null;
  /** Momento del escaneo local del código 44 (o null). Deriva de lsd+scanEvents. */
  code44At: Date | null;
}

export interface NormalizedTracking {
  trackingNumber: string;
  /** Ordenados ascendente por `occurredAt`. */
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
  commitDateTime: Date | null;
  header: TrackingHeader;
  validation: StatusValidation;
}

/** Historial existente (para reglas que dependen del pasado: Time Shield, 3×08, pre-registro). */
export interface ExistingState {
  lastOpTime: number;   // ms del último evento OPERATIVO interno (pendiente/en_bodega/en_ruta)
  count08: number;      // nº de exceptionCode='08' ya persistidos
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
  /** Entidad rastreable (Shipment normal o ChargeShipment/F2). */
  shipment: Trackable;
  /** Tipo del rastreable, para persistencia y reglas específicas (p.ej. F2 no cobra). */
  kind: TrackableKind;
  normalized: NormalizedTracking;
  reconcile: ReconcileResult;
  /** Historial existente (lastOpTime, 08). Reglas que dependen del pasado lo leen de aquí. */
  existing: ExistingState;
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
