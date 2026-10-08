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

/**
 * Día operativo (yyyy-MM-dd Hermosillo) de la ruta. `routeDate` es columna DATE: llega como
 * 'yyyy-MM-dd' o como Date a medianoche UTC (día calendario flotante, NO un instante: pasarlo
 * por la zona Hermosillo lo correría al día anterior). `createdAt` sí es un instante.
 */
export function routeDayOf(anchor: Date | string | null | undefined): string | null {
  if (!anchor) return null;
  if (anchor instanceof Date) {
    if (isNaN(anchor.getTime())) return null;
    const iso = anchor.toISOString();
    if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  }
  return toHermosilloDateString(anchor);
}

/** Entrada del historial (shipment_status) mínima para el estatus del cierre. */
export interface ClosureHistoryEntry {
  status: ShipmentStatusType | string;
  timestamp: Date | string | null;
  exceptionCode?: string | null;
}

/**
 * Estatus con el que el CIERRE clasifica una guía: el de FedEx/interno "hasta el último
 * estatus del día en que se realizó la ruta" (decisión del usuario 2026-10-06). Lo que pasó
 * DESPUÉS (otra salida, devolución registrada días después, nuevo DEX) NO cambia el cierre de
 * esa ruta. Toma el último desenlace del día; si no hubo, el último evento del día; si el día
 * no tiene eventos, `null` (el llamador usa el estatus vivo).
 */
export function resolveRouteDayClosureStatus(
  history: ClosureHistoryEntry[] | null | undefined,
  routeAnchor: Date | string | null,
): RouteDayFedexEvent | null {
  const events: RouteDayFedexEvent[] = [];
  for (const h of history ?? []) {
    if (!h?.timestamp || !h.status) continue;
    const occurredAt = h.timestamp instanceof Date ? h.timestamp : new Date(h.timestamp);
    if (isNaN(occurredAt.getTime())) continue;
    events.push({
      status: h.status as ShipmentStatusType,
      occurredAt,
      exceptionCode: h.exceptionCode ?? null,
    });
  }
  return selectRouteDayFedexEvent(events, routeAnchor);
}

/** Evento FedEx mínimo para elegir el estatus del día operativo. */
export interface RouteDayFedexEvent {
  status: ShipmentStatusType;
  occurredAt: Date;
  exceptionCode: string | null;
}

/**
 * Elige el estatus de FedEx "tal como estaba al cierre del DÍA OPERATIVO de la ruta": el ÚLTIMO
 * DESENLACE real de FedEx que ocurrió EN ese día (zona Hermosillo); si el día no tuvo ningún
 * desenlace, el último evento del día (operativo, que nunca fuerza nada). Semántica ESTRICTA del cierre —
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
  routeAnchor: Date | string | null,
): RouteDayFedexEvent | null {
  const routeDay = routeDayOf(routeAnchor);
  if (!routeDay) return null;
  let lastAny: RouteDayFedexEvent | null = null;
  let lastOutcome: RouteDayFedexEvent | null = null;
  for (const e of events) {
    if (!e?.occurredAt) continue;
    if (toHermosilloDateString(e.occurredAt) !== routeDay) continue;
    const t = e.occurredAt.getTime();
    if (!lastAny || t > lastAny.occurredAt.getTime()) lastAny = e;
    if (isResolvedFedexOutcome(e.status) && (!lastOutcome || t > lastOutcome.occurredAt.getTime())) lastOutcome = e;
  }
  // Tras un DEX, FedEx escanea el paquete de regreso en estación (AR "At local FedEx facility",
  // a veces con 44) ese mismo día: es operativo y NO borra el desenlace (caso 383934486493).
  return lastOutcome ?? lastAny;
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

/**
 * Excepción por sucursal (`subsidiary.closureAcceptsAnyDayDelivery`, hoy solo Loreto, decisión
 * del usuario 2026-10-07): si la guía YA está ENTREGADA, el cierre la toma como entregada aunque
 * la entrega haya sido ANTES del día de la ruta (Loreto saca a ruta paquetes que FedEx ya marcó
 * entregados) o DESPUÉS (ruta capturada en la tarde y entregada al día siguiente). Solo
 * entregados: una devolución de otro día sigue sin cambiar el cierre (regla del día de la ruta).
 *
 * Devuelve el estatus del cierre (el del día de la ruta si no aplica la excepción).
 */
export function applyAnyDayDeliveryToClosure(
  routeDay: RouteDayFedexEvent | null,
  live: { status?: ShipmentStatusType | string | null; history?: ClosureHistoryEntry[] | null },
  enabled: boolean,
): { status: ShipmentStatusType; occurredAt: Date | null; exceptionCode: string | null } | null {
  if (!enabled || live.status !== ShipmentStatusType.ENTREGADO) return routeDay;
  if (routeDay?.status === ShipmentStatusType.ENTREGADO) return routeDay;
  let deliveredAt: Date | null = null;
  for (const h of live.history ?? []) {
    if (h?.status !== ShipmentStatusType.ENTREGADO || !h.timestamp) continue;
    const t = h.timestamp instanceof Date ? h.timestamp : new Date(h.timestamp);
    if (!isNaN(t.getTime()) && (!deliveredAt || t > deliveredAt)) deliveredAt = t;
  }
  return { status: ShipmentStatusType.ENTREGADO, occurredAt: deliveredAt, exceptionCode: null };
}

/** Convierte el historial (shipment_status) a eventos válidos. */
function toClosureEvents(history: ClosureHistoryEntry[] | null | undefined): RouteDayFedexEvent[] {
  const events: RouteDayFedexEvent[] = [];
  for (const h of history ?? []) {
    if (!h?.timestamp || !h.status) continue;
    const occurredAt = h.timestamp instanceof Date ? h.timestamp : new Date(h.timestamp);
    if (isNaN(occurredAt.getTime())) continue;
    events.push({ status: h.status as ShipmentStatusType, occurredAt, exceptionCode: h.exceptionCode ?? null });
  }
  return events;
}

/**
 * Estatus del cierre con la regla de VENTANA (opción por sucursal
 * `subsidiary.closureUntilNextDispatch`, decisión del usuario 2026-10-08, salida Vía Larga
 * 929567984667): cuenta todo lo que pasó desde el inicio del DÍA de la ruta (zona Hermosillo,
 * para no perder desenlaces de la mañana en sucursales de captura tardía) hasta que la guía sale
 * en OTRA ruta (`windowEnd`, exclusivo; `null` = no ha vuelto a salir). Así los entregados y DEX
 * que FedEx reporta al día siguiente quedan en esta ruta, y lo de una salida nueva no se cruza
 * (caso 383934486493). Último desenlace de la ventana; si no hubo, último evento; si nada, null.
 */
export function selectRouteWindowEvent(
  events: RouteDayFedexEvent[],
  routeAnchor: Date | string | null,
  windowEnd: Date | null,
): RouteDayFedexEvent | null {
  const routeDay = routeDayOf(routeAnchor);
  if (!routeDay) return null;
  const endMs = windowEnd ? windowEnd.getTime() : Infinity;
  let lastAny: RouteDayFedexEvent | null = null;
  let lastOutcome: RouteDayFedexEvent | null = null;
  for (const e of events) {
    if (!e?.occurredAt) continue;
    if (toHermosilloDateString(e.occurredAt) < routeDay) continue;
    const t = e.occurredAt.getTime();
    if (t >= endMs) continue;
    if (!lastAny || t > lastAny.occurredAt.getTime()) lastAny = e;
    if (isResolvedFedexOutcome(e.status) && (!lastOutcome || t > lastOutcome.occurredAt.getTime())) lastOutcome = e;
  }
  return lastOutcome ?? lastAny;
}

export function resolveRouteWindowClosureStatus(
  history: ClosureHistoryEntry[] | null | undefined,
  routeAnchor: Date | string | null,
  windowEnd: Date | null,
): RouteDayFedexEvent | null {
  return selectRouteWindowEvent(toClosureEvents(history), routeAnchor, windowEnd);
}

export interface ClosureStatusInput {
  history: ClosureHistoryEntry[] | null | undefined;
  routeAnchor: Date | string | null;
  liveStatus: ShipmentStatusType | string | null | undefined;
  /** Opción de sucursal: ventana hasta la siguiente salida en vez del día de la ruta. */
  untilNextDispatch: boolean;
  /** Cuándo salió la guía en la siguiente ruta (null = no ha vuelto a salir). */
  nextDispatchAt: Date | null;
  /** Opción de sucursal (Loreto): entregado de cualquier día cuenta. */
  acceptAnyDayDelivery: boolean;
  /** Arreglo manual del superadmin ("Paquetes con problema") guardado para ESTA salida. */
  override: RouteDayFedexEvent | null;
}

/**
 * Estatus con el que el cierre clasifica una guía. Orden: arreglo manual del superadmin >
 * regla de la sucursal (ventana hasta la siguiente salida, o día de la ruta) > excepción de
 * entregados de cualquier día (Loreto). Fuente única para la vista del cierre y el diagnóstico.
 */
export function resolveClosureStatus(input: ClosureStatusInput): RouteDayFedexEvent | null {
  if (input.override) return input.override;
  const base = input.untilNextDispatch
    ? resolveRouteWindowClosureStatus(input.history, input.routeAnchor, input.nextDispatchAt)
    : resolveRouteDayClosureStatus(input.history, input.routeAnchor);
  return applyAnyDayDeliveryToClosure(
    base,
    { status: input.liveStatus, history: input.history },
    input.acceptAnyDayDelivery,
  );
}
