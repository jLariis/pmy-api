import { BadRequestException } from '@nestjs/common';
import { OpsSettings } from '../ops-alerts/ops-alerts.util';
import { Schedule } from './daily-task.types';

/** Predefinidos acordados (2026-10-17) para los horarios que no existen en la configuración general. */
export const DEFAULT_SCHEDULE = {
  uploadMinutes: 30,
  unloadingTime: '21:00',
  dispatchAfterUnloadMinutes: 120,
  dispatchNextDayTime: '10:00',
  closureTime: '21:00',
  inventoryInitialTime: '10:00',
  devolutionsTime: '19:30',
  inventoryFinalTime: '20:00',
} as const satisfies Omit<Schedule, 'activeTo' | 'completePct'>;

const pick = <T>(...v: (T | null | undefined)[]): T => v.find((x) => x !== null && x !== undefined) as T;

/** Horarios de una sucursal: su columna si la tiene; si no, el general; si no, el predefinido. */
export function resolveSchedule(global: OpsSettings, sub: Partial<Schedule> | null): Schedule {
  const s = sub ?? {};
  return {
    uploadMinutes: pick(s.uploadMinutes, global.uploadMinutes, DEFAULT_SCHEDULE.uploadMinutes),
    unloadingTime: pick(s.unloadingTime, global.unloadingTime, DEFAULT_SCHEDULE.unloadingTime),
    dispatchAfterUnloadMinutes: pick(s.dispatchAfterUnloadMinutes, DEFAULT_SCHEDULE.dispatchAfterUnloadMinutes),
    dispatchNextDayTime: pick(s.dispatchNextDayTime, global.dispatchTime, DEFAULT_SCHEDULE.dispatchNextDayTime),
    closureTime: pick(s.closureTime, global.closureTime, DEFAULT_SCHEDULE.closureTime),
    inventoryInitialTime: pick(s.inventoryInitialTime, DEFAULT_SCHEDULE.inventoryInitialTime),
    devolutionsTime: pick(s.devolutionsTime, DEFAULT_SCHEDULE.devolutionsTime),
    inventoryFinalTime: pick(s.inventoryFinalTime, DEFAULT_SCHEDULE.inventoryFinalTime),
    activeTo: global.activeTo,
    completePct: global.completePct,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SCHEDULE_TIME_FIELDS = ['unloadingTime', 'dispatchNextDayTime', 'closureTime', 'inventoryInitialTime', 'devolutionsTime', 'inventoryFinalTime'] as const;
export const SCHEDULE_MINUTE_FIELDS = ['uploadMinutes', 'dispatchAfterUnloadMinutes'] as const;
type ScheduleField = (typeof SCHEDULE_TIME_FIELDS)[number] | (typeof SCHEDULE_MINUTE_FIELDS)[number];

/** Valida los horarios de una sucursal. `null` = usar los valores generales. Solo devuelve campos de horario. */
export function validateSchedulePatch(patch: Record<string, unknown>): Partial<Record<ScheduleField, string | number | null>> {
  const out: Partial<Record<ScheduleField, string | number | null>> = {};
  for (const k of SCHEDULE_TIME_FIELDS) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null || patch[k] === '') { out[k] = null; continue; }
    if (!HHMM.test(String(patch[k]))) throw new BadRequestException('Hora no válida (usa HH:MM)');
    out[k] = String(patch[k]);
  }
  for (const k of SCHEDULE_MINUTE_FIELDS) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null || patch[k] === '') { out[k] = null; continue; }
    const n = Number(patch[k]);
    if (!Number.isInteger(n) || n < 0 || n > 1440) throw new BadRequestException('Los minutos deben ser un número entero entre 0 y 1440');
    out[k] = n;
  }
  return out;
}
