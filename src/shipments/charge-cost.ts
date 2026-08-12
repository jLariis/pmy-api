/**
 * Costo a cobrar por una carga F2 según el flag de "1.5 toneladas".
 *
 * Regla (autoritativa en backend, no confía ciegamente en el front):
 *  - Si `isHalfTon` está activo Y la sucursal tiene `chargeCostHalfTon > 0`,
 *    se usa `chargeCostHalfTon` (hoy solo Hermosillo lo tiene sembrado en 3900).
 *  - En cualquier otro caso cae al `chargeCost` normal → el flag es no-op para
 *    sucursales sin costo 1.5 ton configurado.
 */
export function resolveChargeCost(
  subsidiary: { chargeCost?: number | string | null; chargeCostHalfTon?: number | string | null },
  isHalfTon: boolean,
): number {
  const halfTon = Number(subsidiary?.chargeCostHalfTon ?? 0);
  const normal = Number(subsidiary?.chargeCost ?? 0);
  const chosen = isHalfTon && halfTon > 0 ? halfTon : normal;
  return Number.isFinite(chosen) ? chosen : 0;
}
