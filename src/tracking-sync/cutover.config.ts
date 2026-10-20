/**
 * Cutover del motor por eventos (F3/F4). DEFAULT OFF: mientras esté apagado, el legacy
 * (processMasterFedexUpdate/generateIncomes) manda y el motor solo observa en shadow.
 *
 * Modos (`cutoverMode()`):
 *  - 'off'     — `TRACKING_SYNC_CUTOVER` apagado: el legacy horario hace todo; el motor observa.
 *  - 'coexist' — encendido CON lista `TRACKING_SYNC_CUTOVER_SUBSIDIARIES` (piloto, p. ej. Cabo):
 *                el motor escribe estatus y cobros cada 15 min de las RUTAS DEL DÍA de esas
 *                sucursales (07:00–22:00); el legacy horario sigue con TODO lo demás (bodega,
 *                rutas de otros días, fuera de horario, el resto de sucursales) y con DHL. El
 *                shadow sigue observando a las sucursales fuera de la lista.
 *  - 'full'    — encendido SIN lista: el motor hace todo FedEx (rutas cada 15 min + barrida diaria
 *                05:00); el legacy solo rastrea DHL.
 * Estatus y cobros de una guía siempre los escribe UN solo motor: el legacy cede exactamente lo
 * que toma el motor.
 */
export type CutoverMode = 'off' | 'coexist' | 'full';

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

export function cutoverMode(): CutoverMode {
  if (!isCutoverEnabled()) return 'off';
  return cutoverSubsidiaryIds().length ? 'coexist' : 'full';
}

/** ¿Esta sucursal está en cutover? (global on + allowlist vacía o que la incluya). */
export function isSubsidiaryInCutover(subsidiaryId: string | null | undefined): boolean {
  if (!isCutoverEnabled()) return false;
  const allow = cutoverSubsidiaryIds();
  if (allow.length === 0) return true;
  return !!subsidiaryId && allow.includes(subsidiaryId);
}

/** Horario del motor de rutas (cada 15 min), hora de Hermosillo: [inicio, fin). */
export const ENGINE_START_HOUR = Number(process.env.FEDEX_SYNC_START_HOUR || 7);
export const ENGINE_END_HOUR = Number(process.env.FEDEX_SYNC_END_HOUR || 22);

export function isEngineHour(hour: number): boolean {
  return hour >= ENGINE_START_HOUR && hour < ENGINE_END_HOUR;
}

/** Hora actual en Hermosillo (0–23). */
export function hermosilloHour(now: Date = new Date()): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Hermosillo', hour: '2-digit', hour12: false }).format(now));
  return h % 24;
}

/**
 * Qué guías FedEx cede el legacy al motor en esta corrida: en 'coexist', dentro del horario del
 * motor, las rutas del día de las sucursales en la lista; fuera de horario, ninguna (el motor no
 * corre y el legacy las cubre). Devuelve `null` en 'full' = el legacy no rastrea FedEx.
 */
export function legacyFedexScope(mode: CutoverMode, hour: number): 'all' | 'except-cutover-routes' | null {
  if (mode === 'off') return 'all';
  if (mode === 'full') return null;
  return isEngineHour(hour) ? 'except-cutover-routes' : 'all';
}
