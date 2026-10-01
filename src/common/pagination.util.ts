/**
 * Utilidades de paginación y rango de fechas para listados (evita cargar todo
 * el histórico en memoria).
 */

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Normaliza page/limit (page 1-based) y calcula el offset. */
export function parsePagination(
  page?: string | number,
  limit?: string | number,
  defaultLimit = DEFAULT_LIMIT,
): { page: number; limit: number; skip: number } {
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const l = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(limit)) || defaultLimit));
  return { page: p, limit: l, skip: (p - 1) * l };
}

/** Hermosillo es UTC-7 fijo (sin horario de verano): 00:00 local = 07:00Z. */
const HERMOSILLO_OFFSET_HOURS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const YYYY_MM_DD = /^(\d{4})-(\d{2})-(\d{2})/;

/** 00:00:00.000 de Hermosillo del día calendario (y, m0, d), expresado en UTC. */
function hermosilloMidnightUtc(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d, HERMOSILLO_OFFSET_HOURS, 0, 0, 0));
}

/**
 * Inicio y fin (inclusive) en UTC de los días calendario de Hermosillo `fromDay`..`toDay`.
 * El server corre en UTC (main.ts), así que NO se usa setHours (eso cortaría el día a
 * medianoche UTC = 17:00 de Hermosillo del día anterior).
 */
function hermosilloDayRange(fromDay: Date, toDay: Date): { start: Date; end: Date } {
  const start = hermosilloMidnightUtc(fromDay.getUTCFullYear(), fromDay.getUTCMonth(), fromDay.getUTCDate());
  const nextDay = hermosilloMidnightUtc(toDay.getUTCFullYear(), toDay.getUTCMonth(), toDay.getUTCDate() + 1);
  return { start, end: new Date(nextDay.getTime() - 1) };
}

/** Día calendario (como fecha UTC 00:00) de un 'YYYY-MM-DD' o, si es un instante, su día en Hermosillo. */
function toCalendarDay(value: string): Date | null {
  const m = YYYY_MM_DD.exec(value);
  if (m && value.length === 10) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() - HERMOSILLO_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/**
 * Semana calendario LUNES 00:00 – DOMINGO 23:59:59.999 (hora de Hermosillo) que contiene
 * `now`, expresada en UTC. Consistente con `getWeekRange` del frontend (lib/week.ts):
 * el domingo cierra su propia semana.
 */
export function currentWeekRange(now: Date = new Date()): { start: Date; end: Date } {
  const today = toCalendarDay(now.toISOString())!;
  const day = today.getUTCDay(); // 0=Dom .. 6=Sab
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today.getTime() + diffToMonday * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return hermosilloDayRange(monday, sunday);
}

/**
 * Resuelve el rango de fechas a usar: si llegan `from`/`to` válidos (días calendario
 * 'YYYY-MM-DD' de Hermosillo) se usan inclusive de inicio a fin de día; si no, se usa la
 * semana actual (lun–dom).
 */
export function resolveDateRange(from?: string, to?: string, now: Date = new Date()): { start: Date; end: Date } {
  if (from && to) {
    const fromDay = toCalendarDay(from);
    const toDay = toCalendarDay(to);
    if (fromDay && toDay) return hermosilloDayRange(fromDay, toDay);
  }
  return currentWeekRange(now);
}
