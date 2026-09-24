/**
 * Semáforo de mantenimiento por km + fecha (gana el más severo).
 * ESPEJO de app-pmy `lib/maintenance-status.ts` — mantener ambos en sync.
 */
export type MaintenanceLight = 'vencido' | 'proximo' | 'al_dia' | 'sin_datos';

export interface MaintenanceStatusInput {
  kms?: number | null;
  lastMaintenanceKms?: number | null;
  maintenanceIntervalKms?: number | null;
  nextMaintenanceDate?: string | Date | null;
}

export interface MaintenanceStatusResult {
  light: MaintenanceLight;
  nextKms: number | null;
  kmsRemaining: number | null;
  daysRemaining: number | null;
}

export const PROXIMO_KMS = 1000;
export const PROXIMO_DAYS = 15;
export const DEFAULT_INTERVAL_KMS = 5000;

const DAY = 86_400_000;
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function maintenanceStatus(v: MaintenanceStatusInput, today: Date = new Date()): MaintenanceStatusResult {
  const hasKms = v.lastMaintenanceKms !== null && v.lastMaintenanceKms !== undefined;
  const nextKms = hasKms ? Number(v.lastMaintenanceKms) + Number(v.maintenanceIntervalKms || DEFAULT_INTERVAL_KMS) : null;
  const kmsRemaining = nextKms !== null && v.kms !== null && v.kms !== undefined ? nextKms - Number(v.kms) : null;
  const date = v.nextMaintenanceDate ? new Date(v.nextMaintenanceDate) : null;
  const daysRemaining = date && !isNaN(date.getTime()) ? Math.round((dayStart(date) - dayStart(today)) / DAY) : null;

  if (nextKms === null && daysRemaining === null) return { light: 'sin_datos', nextKms, kmsRemaining, daysRemaining };

  let light: MaintenanceLight = 'al_dia';
  if ((kmsRemaining !== null && kmsRemaining <= 0) || (daysRemaining !== null && daysRemaining < 0)) light = 'vencido';
  else if ((kmsRemaining !== null && kmsRemaining <= PROXIMO_KMS) || (daysRemaining !== null && daysRemaining <= PROXIMO_DAYS)) light = 'proximo';
  return { light, nextKms, kmsRemaining, daysRemaining };
}
