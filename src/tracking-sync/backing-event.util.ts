import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

const DELIVERED = new Set<ShipmentStatusType>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
]);

/**
 * Evento de FedEx que RESPALDA un estatus: el último evento con ese estatus (para ENTREGADO
 * también cuenta la entrega "por FedEx", que la regla de ruta nuestra convierte en ENTREGADO).
 * `null` si ningún evento lo respalda (p. ej. el estatus vino solo del encabezado DL).
 *
 * Regla (bug 2026-10-07, cargas F2 31.5 de La Paz): si el estatus cambia por un evento, ese
 * evento SIEMPRE se guarda en el historial, aunque el candado de pre-registro lo haya vetado;
 * si no, la guía queda ENTREGADA sin su fila de entrega en shipment_status.
 */
export function selectBackingEvent<E extends { status: ShipmentStatusType; occurredAt: Date }>(
  events: readonly E[],
  target: ShipmentStatusType,
): E | null {
  let best: E | null = null;
  for (const e of events) {
    const match = e.status === target || (DELIVERED.has(target) && DELIVERED.has(e.status));
    if (match && (!best || e.occurredAt.getTime() >= best.occurredAt.getTime())) best = e;
  }
  return best;
}
