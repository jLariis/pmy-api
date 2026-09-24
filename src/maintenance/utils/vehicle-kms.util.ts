/** Salto máximo aceptado entre dos capturas de km (evita errores de dedo). */
export const MAX_KMS_JUMP = 5000;
/**
 * Rango plausible de un odómetro. Debajo son placeholders que capturan algunas sucursales
 * ("1", "2", "00000"); arriba son errores de dedo ("1234556").
 */
export const MIN_PLAUSIBLE_KMS = 10;
export const MAX_PLAUSIBLE_KMS = 1_000_000;

export type KmsSkipReason = 'invalid' | 'not_greater' | 'jump';

const isPlausible = (n: number | null | undefined): n is number =>
  typeof n === 'number' && n >= MIN_PLAUSIBLE_KMS && n <= MAX_PLAUSIBLE_KMS;

/** Convierte una captura libre ("12,345 km") a entero plausible, o null si no lo es. */
export function parseKms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return isPlausible(r) ? r : null;
}

/**
 * Regla "el km solo sube": devuelve el nuevo km del vehículo a partir de una captura
 * (salida a ruta, cierre, solicitud o cierre de orden). Nunca retrocede ni acepta saltos absurdos.
 * Si el km actual no es plausible (vacío o basura histórica), acepta la primera captura válida.
 */
export function nextVehicleKms(
  current: number | null | undefined,
  captured: unknown,
): { kms: number | null; changed: boolean; reason?: KmsSkipReason } {
  const cur = current ?? null;
  const cap = parseKms(captured);
  if (cap === null) return { kms: cur, changed: false, reason: 'invalid' };
  if (!isPlausible(cur)) return { kms: cap, changed: true };
  if (cap <= cur) return { kms: cur, changed: false, reason: 'not_greater' };
  if (cap - cur > MAX_KMS_JUMP) return { kms: cur, changed: false, reason: 'jump' };
  return { kms: cap, changed: true };
}
