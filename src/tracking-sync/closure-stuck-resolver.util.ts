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

export interface StuckResolveInput {
  /** Estatus interno ACTUAL de la guía tras la reconciliación normal (applyByRoute). */
  currentStatus: ShipmentStatusType;
  /** Último estatus CRUDO de FedEx (antes del Time Shield): `ctx.reconcile.proposedStatus`. */
  fedexLastStatus: ShipmentStatusType | null;
  /** Instante del último evento de FedEx (`ctx.normalized.latest.occurredAt`). */
  fedexLastEventAt: Date | null;
  /** Día operativo de la ruta (routeDate, o createdAt de respaldo). */
  routeAnchor: Date | null;
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
 * `new Date()` (hoy): si el cierre se abre en un día distinto al del evento (cerrar hoy la ruta
 * de ayer), dejaba de aplicar y el paquete quedaba EN_RUTA para siempre.
 *
 * Este resolver ancla la comparación al **día operativo de la ruta (`routeAnchor`)**, no al reloj
 * de pared. Fuerza FedEx solo si:
 *  - la sucursal es de persistencia (captura tardía),
 *  - la guía sigue EN_RUTA tras la reconciliación normal,
 *  - FedEx reporta un desenlace real (no operativo),
 *  - y ese evento cae en el día operativo de la ruta o después (`eventDay >= routeDay`).
 *
 * Eventos ANTERIORES al día de la ruta NO se tocan: ahí el Time Shield protege legítimamente un
 * EN_RUTA que sí salió después de un evento viejo.
 */
export function shouldForceFedexAtClosure(input: StuckResolveInput): boolean {
  if (!input.persistenceBranch) return false;
  if (input.currentStatus !== ShipmentStatusType.EN_RUTA) return false;
  if (!isResolvedFedexOutcome(input.fedexLastStatus)) return false;
  if (!input.fedexLastEventAt || !input.routeAnchor) return false;

  const eventDay = toHermosilloDateString(input.fedexLastEventAt);
  const routeDay = toHermosilloDateString(input.routeAnchor);
  return eventDay >= routeDay;
}
