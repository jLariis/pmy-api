/**
 * Cálculo de "horas hábiles" para el SLA: sumar N horas de trabajo a una fecha,
 * contando solo la ventana laboral (p. ej. L–V 9:00–18:00 en America/Mexico_City)
 * y saltando noches, fines de semana y días no laborables. Lógica pura basada en
 * luxon (zona horaria correcta). Feature-flag `SUPPORT_SLA_BUSINESS_HOURS=false`
 * para volver al conteo 24/7.
 */
import { DateTime } from 'luxon';

export interface BusinessHoursConfig {
  zone: string;
  startHour: number; // hora de apertura (0-23)
  endHour: number; // hora de cierre (0-23), > startHour
  /** Días laborables en formato luxon: 1=Lun … 7=Dom. */
  workdays: number[];
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  zone: 'America/Mexico_City',
  startHour: 9,
  endHour: 18,
  workdays: [1, 2, 3, 4, 5],
};

/** ¿Se cuenta el SLA en horario hábil? Default sí; env lo desactiva (vuelve a 24/7). */
export function businessHoursEnabled(): boolean {
  return process.env.SUPPORT_SLA_BUSINESS_HOURS !== 'false';
}

export function getBusinessHoursConfig(): BusinessHoursConfig {
  const cfg = { ...DEFAULT_BUSINESS_HOURS };
  if (process.env.SUPPORT_BUSINESS_TZ) cfg.zone = process.env.SUPPORT_BUSINESS_TZ;
  const s = Number(process.env.SUPPORT_BUSINESS_START);
  const e = Number(process.env.SUPPORT_BUSINESS_END);
  if (Number.isInteger(s) && s >= 0 && s < 24) cfg.startHour = s;
  if (Number.isInteger(e) && e > 0 && e <= 24) cfg.endHour = e;
  const days = process.env.SUPPORT_BUSINESS_DAYS;
  if (days) {
    const parsed = days.split(',').map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 7);
    if (parsed.length) cfg.workdays = parsed;
  }
  return cfg;
}

/**
 * Suma `hours` horas hábiles a `from`, respetando la ventana laboral. Devuelve un
 * `Date` (instante absoluto). Si `hours <= 0`, regresa `from` sin cambios.
 */
export function addBusinessHours(
  from: Date | string,
  hours: number,
  cfg: BusinessHoursConfig = getBusinessHoursConfig(),
): Date {
  const { zone, startHour, endHour, workdays } = cfg;
  let dt = DateTime.fromJSDate(new Date(from)).setZone(zone);
  let remainingMs = Math.max(0, hours) * 3600_000;
  if (remainingMs === 0) return dt.toJSDate();

  const workdaySet = new Set(workdays);
  let guard = 0;

  while (remainingMs > 0 && guard++ < 100_000) {
    const dayStart = dt.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
    const dayEnd = dt.set({ hour: endHour, minute: 0, second: 0, millisecond: 0 });
    const isWorkday = workdaySet.has(dt.weekday);

    if (!isWorkday || dt >= dayEnd) {
      // Fuera de día laboral o ya cerró → siguiente día a la hora de apertura.
      dt = dt.plus({ days: 1 }).set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
      continue;
    }
    if (dt < dayStart) {
      // Antes de abrir → salta a la apertura del mismo día.
      dt = dayStart;
      continue;
    }
    // Dentro de la ventana laboral: consume hasta el cierre.
    const msUntilEnd = dayEnd.toMillis() - dt.toMillis();
    if (remainingMs <= msUntilEnd) {
      dt = dt.plus({ milliseconds: remainingMs });
      remainingMs = 0;
    } else {
      remainingMs -= msUntilEnd;
      dt = dayEnd; // el tope del while lo empuja al siguiente día
    }
  }

  return dt.toJSDate();
}
