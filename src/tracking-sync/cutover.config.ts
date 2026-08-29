/**
 * Cutover del motor por eventos (F3/F4). DEFAULT OFF: mientras esté apagado, el legacy
 * (processMasterFedexUpdate/generateIncomes) manda y el motor solo observa en shadow.
 *
 * Al encender `TRACKING_SYNC_CUTOVER=true`:
 *   - el cron legacy horario se salta (no doble-escribe),
 *   - el cron persistente del motor escribe estatus, y
 *   - el sink persistente genera los cobros (IncomeExecutor 'persist').
 * Estatus y cobros se cortan JUNTOS: el ingreso legacy vive dentro del cron legacy, así
 * que no se pueden separar sin doble-cron.
 *
 * Rollout gradual opcional por sucursal: `TRACKING_SYNC_CUTOVER_SUBSIDIARIES` = lista de
 * ids separados por coma. Si está vacía, el cutover aplica a TODAS cuando la bandera global
 * está encendida.
 */
export function isCutoverEnabled(): boolean {
  return String(process.env.TRACKING_SYNC_CUTOVER).toLowerCase() === 'true';
}

/** Ids de sucursal en cutover (allowlist). Vacío = todas (cuando la global está on). */
export function cutoverSubsidiaryIds(): string[] {
  return String(process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ¿Esta sucursal está en cutover? (global on + allowlist vacía o que la incluya). */
export function isSubsidiaryInCutover(subsidiaryId: string | null | undefined): boolean {
  if (!isCutoverEnabled()) return false;
  const allow = cutoverSubsidiaryIds();
  if (allow.length === 0) return true;
  return !!subsidiaryId && allow.includes(subsidiaryId);
}
