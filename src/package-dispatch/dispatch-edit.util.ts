import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';

/** Solo se editan salidas abiertas: una cerrada ya generó ingresos (decisión A1). */
export function canEditDispatch(status: string | null | undefined): boolean {
  return status !== DispatchStatus.COMPLETADA && status !== DispatchStatus.CANCELADA;
}

/**
 * Estatus al que regresa una guía que se QUITA de la salida (decisión B1): el último
 * estatus que tenía antes de salir a ruta. Se busca en su historial el registro más
 * reciente anterior (o igual) a cuando entró a la salida que no sea "en ruta".
 * Sin historial útil ⇒ "en bodega".
 */
export function statusBeforeDispatch(
  history: { status: string | null; timestamp: Date | string | null }[],
  addedAt: Date | string | null | undefined,
): string {
  const limit = addedAt ? new Date(addedAt).getTime() : Number.POSITIVE_INFINITY;
  const prev = history
    .filter((h) => h?.status && h.status !== ShipmentStatusType.EN_RUTA && h.timestamp)
    .map((h) => ({ status: h.status as string, t: new Date(h.timestamp as any).getTime() }))
    .filter((h) => !Number.isNaN(h.t) && h.t <= limit)
    .sort((a, b) => b.t - a.t)[0];
  return prev?.status ?? ShipmentStatusType.EN_BODEGA;
}

/** Motivo obligatorio y limpio (máx. 500, lo que guarda la bitácora). */
export function normalizeReason(reason: unknown): string {
  return String(reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
}
