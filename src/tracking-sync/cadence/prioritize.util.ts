import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { TrackableItem } from '../tracking-sync.types';

/**
 * Cadencia adaptativa: prioriza las guías "calientes" (movimiento activo con FedEx) sobre
 * las "tibias". Es un ORDENAMIENTO estable + tope opcional. Reutilizable por el cron
 * persistente (cutover) para acotar cuánto se consulta por corrida sin perder las urgentes.
 * En shadow se usa solo para ORDENAR (sin tope) — no cambia la cobertura.
 */

// Estatus con movimiento activo (conviene refrescar seguido).
const HOT_STATUSES = new Set<string>([
  ShipmentStatusType.EN_RUTA,
  ShipmentStatusType.ACARGO_DE_FEDEX,
  ShipmentStatusType.ESTACION_FEDEX,
  ShipmentStatusType.DEMORA_EN_ENTREGA,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  ShipmentStatusType.DIRECCION_INCORRECTA,
  ShipmentStatusType.LLEGADO_DESPUES,
  ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
].map((s) => String(s)));

export type CadenceTier = 'hot' | 'warm';

export function tierOf(status: unknown): CadenceTier {
  return HOT_STATUSES.has(String(status)) ? 'hot' : 'warm';
}

/**
 * Devuelve los items ordenados (calientes primero), preservando el orden relativo dentro
 * de cada tier (estable). Con `cap` recorta al máximo indicado (para el cron persistente).
 */
export function prioritizeTrackables(items: TrackableItem[], opts?: { cap?: number }): TrackableItem[] {
  const hot: TrackableItem[] = [];
  const warm: TrackableItem[] = [];
  for (const it of items) {
    (tierOf((it.entity as any)?.status) === 'hot' ? hot : warm).push(it);
  }
  const ordered = [...hot, ...warm];
  const cap = opts?.cap;
  return typeof cap === 'number' && cap >= 0 ? ordered.slice(0, cap) : ordered;
}
