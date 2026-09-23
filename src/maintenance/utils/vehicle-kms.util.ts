/** Salto máximo aceptado entre dos capturas de km (evita errores de dedo). */
export const MAX_KMS_JUMP = 5000;

export type KmsSkipReason = 'invalid' | 'not_greater' | 'jump';

/** Convierte una captura libre ("12,345 km") a entero positivo, o null si no es válida. */
export function parseKms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Regla "el km solo sube": devuelve el nuevo km del vehículo a partir de una captura
 * (salida a ruta, cierre, solicitud o cierre de orden). Nunca retrocede ni acepta saltos absurdos.
 */
export function nextVehicleKms(
  current: number | null | undefined,
  captured: unknown,
): { kms: number | null; changed: boolean; reason?: KmsSkipReason } {
  const cur = current ?? null;
  const cap = parseKms(captured);
  if (cap === null) return { kms: cur, changed: false, reason: 'invalid' };
  if (cur === null || cur === 0) return { kms: cap, changed: true };
  if (cap <= cur) return { kms: cur, changed: false, reason: 'not_greater' };
  if (cap - cur > MAX_KMS_JUMP) return { kms: cur, changed: false, reason: 'jump' };
  return { kms: cap, changed: true };
}
