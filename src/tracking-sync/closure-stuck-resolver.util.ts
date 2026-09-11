import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';

/**
 * Estatus "en vuelo"/operativos internos: NO representan un desenlace real de FedEx, así que
 * un evento con estos estatus jamás debe forzar el desbloqueo de un EN_RUTA en el cierre. El
 * resto (rechazado, cliente_no_disponible, entregado, devuelto, demora, etc.) SÍ es un
 * desenlace concreto que FedEx ya reportó.
 */
const OPERATIONAL_OR_UNKNOWN = new Set<ShipmentStatusType>([
  ShipmentStatusType.RECOLECCION,
  ShipmentStatusType.RECIBIDO_EN_BODEGA,
  ShipmentStatusType.PENDIENTE,
  ShipmentStatusType.EN_RUTA,
  ShipmentStatusType.EN_TRANSITO,
  ShipmentStatusType.EN_BODEGA,
  ShipmentStatusType.DESCONOCIDO,
]);

/** ¿El estatus reportado por FedEx es un desenlace real (no un estado operativo interno)? */
export function isResolvedFedexOutcome(status: ShipmentStatusType | null | undefined): boolean {
  return !!status && !OPERATIONAL_OR_UNKNOWN.has(status);
}

/** Evento FedEx mínimo para elegir el estatus del día operativo. */
export interface RouteDayFedexEvent {
  status: ShipmentStatusType;
  occurredAt: Date;
  exceptionCode: string | null;
}

/**
 * Elige el estatus de FedEx "tal como estaba al cierre del DÍA OPERATIVO de la ruta": el ÚLTIMO
 * evento de FedEx que ocurrió EN ese día (zona Hermosillo). Semántica ESTRICTA del cierre —
 * cerrar la ruta de ayer NO debe tomar estatus de hoy, sino los del día en que se creó la ruta.
 *
 * - Eventos de días POSTERIORES a la ruta se ignoran (p. ej. una entrega al día siguiente no
 *   cambia el desenlace del cierre de ayer).
 * - Eventos de días ANTERIORES se ignoran (evento viejo pre-ruta; el paquete salió después).
 *
 * Devuelve `null` si FedEx no tuvo ningún evento en el día de la ruta.
 */
export function selectRouteDayFedexEvent(
  events: RouteDayFedexEvent[],
  routeAnchor: Date | null,
): RouteDayFedexEvent | null {
  if (!routeAnchor) return null;
  const routeDay = toHermosilloDateString(routeAnchor);
  let picked: RouteDayFedexEvent | null = null;
  for (const e of events) {
    if (!e?.occurredAt) continue;
    if (toHermosilloDateString(e.occurredAt) !== routeDay) continue;
    if (!picked || e.occurredAt.getTime() > picked.occurredAt.getTime()) picked = e;
  }
  return picked;
}

export interface StuckResolveInput {
  /** Estatus interno ACTUAL de la guía tras la reconciliación normal (applyByRoute). */
  currentStatus: ShipmentStatusType;
  /** Estatus del último evento de FedEx OCURRIDO en el día operativo de la ruta (o null). */
  routeDayStatus: ShipmentStatusType | null;
  /** ¿La sucursal opera desde bodega FedEx (captura tardía)? `allowSameDayPreRegistrationFedexEvents`. */
  persistenceBranch: boolean;
}

/**
 * Decisión PURA del resolver de cierre: ¿debemos forzar el estatus real de FedEx sobre un
 * EN_RUTA que el Time Shield dejó pegado?
 *
 * El Time Shield conserva el EN_RUTA cuando el último evento de FedEx es ANTERIOR a nuestra
 * última operación interna. Para sucursales de captura tardía (Hermosillo/persistencia) eso es
 * un falso positivo: la salida a ruta se sella con la hora de captura, DESPUÉS de que FedEx ya
 * marcó el desenlace real del día operativo. La excepción del escudo lo cubría, pero anclada a
 * `new Date()` (hoy): al cerrar la ruta de ayer dejaba de aplicar y el paquete quedaba EN_RUTA.
 *
 * Semántica ESTRICTA: se decide con el estatus del DÍA de la ruta (`routeDayStatus`, calculado
 * por `selectRouteDayFedexEvent`), nunca con el de hoy. Fuerza FedEx solo si:
 *  - la sucursal es de persistencia (captura tardía),
 *  - la guía sigue EN_RUTA tras la reconciliación normal,
 *  - y el desenlace del día de la ruta es real (no operativo).
 */
export function shouldForceFedexAtClosure(input: StuckResolveInput): boolean {
  if (!input.persistenceBranch) return false;
  if (input.currentStatus !== ShipmentStatusType.EN_RUTA) return false;
  return isResolvedFedexOutcome(input.routeDayStatus);
}
