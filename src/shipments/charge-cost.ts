/**
 * Costo a cobrar por una carga F2 según el flag de "1.5 toneladas" y si el día es
 * domingo/festivo.
 *
 * Regla (autoritativa en backend, no confía ciegamente en el front):
 *  1. Se elige la BASE:
 *     - `chargeCostHalfTon` si `isHalfTon` está activo Y la sucursal lo tiene (> 0).
 *     - `chargeCost` normal en cualquier otro caso.
 *  2. Si `isSundayOrHoliday` y la sucursal tiene configurado el sobreprecio
 *     correspondiente (> 0), se usa ese sobreprecio en vez de la base:
 *     - `chargeCostHalfTonSundayHoliday` para cargas 1.5 ton.
 *     - `chargeCostSundayHoliday` para cargas normales.
 *  3. Sin sobreprecio configurado (0) el flag domingo/festivo es no-op → se cobra la base.
 *
 * Hermosillo: normal(1.5 ton) = 4228, domingo/festivo(1.5 ton) = 6004, domingo/festivo(F2) = 6660.
 */
export function resolveChargeCost(
  subsidiary: {
    chargeCost?: number | string | null;
    chargeCostHalfTon?: number | string | null;
    chargeCostSundayHoliday?: number | string | null;
    chargeCostHalfTonSundayHoliday?: number | string | null;
  },
  isHalfTon: boolean,
  isSundayOrHoliday = false,
): number {
  const halfTon = Number(subsidiary?.chargeCostHalfTon ?? 0);
  const normal = Number(subsidiary?.chargeCost ?? 0);
  const halfTonSH = Number(subsidiary?.chargeCostHalfTonSundayHoliday ?? 0);
  const normalSH = Number(subsidiary?.chargeCostSundayHoliday ?? 0);

  const useHalfTon = isHalfTon && halfTon > 0;
  const base = useHalfTon ? halfTon : normal;
  const premium = useHalfTon ? halfTonSH : normalSH;

  const chosen = isSundayOrHoliday && premium > 0 ? premium : base;
  return Number.isFinite(chosen) ? chosen : 0;
}
