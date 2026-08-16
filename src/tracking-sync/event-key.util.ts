import { createHash } from 'crypto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/** Clave determinista final para dedup robusto en el cutover. */
export function buildEventKey(input: {
  trackingNumber: string;
  occurredAt: Date;
  derivedCode?: string | null;
  eventType?: string | null;
  exceptionCode?: string | null;
  location?: string | null;
}): string {
  const parts = [
    input.trackingNumber,
    String(input.occurredAt ? input.occurredAt.getTime() : 0),
    (input.derivedCode || input.eventType || '').toUpperCase(),
    (input.exceptionCode || '').toUpperCase(),
    (input.location || '').toUpperCase(),
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

/**
 * Clave "shadow": reconstruible tanto desde un evento normalizado como desde una fila
 * existente de `shipment_status` (que solo tiene timestamp, exceptionCode y status).
 * Permite detectar eventos nuevos en shadow sin migrar la tabla real.
 */
export function buildShadowKey(
  occurredAtMs: number,
  exceptionCode: string | null | undefined,
  status: ShipmentStatusType,
): string {
  return `${occurredAtMs}|${(exceptionCode || '').trim().toUpperCase()}|${status}`;
}
