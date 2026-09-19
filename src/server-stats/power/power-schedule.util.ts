export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(s: string): boolean {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function normalizeDays(days: number[]): number[] {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error('days: se requiere al menos un día');
  }
  const set = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw new Error(`days: valor inválido ${d} (esperado 1..7)`);
    }
    set.add(d);
  }
  return [...set].sort((a, b) => a - b);
}

const ISO_TO_SYSTEMD: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function daysToOnCalendar(days: number[], time: string): string {
  if (!isValidTime(time)) throw new Error(`time inválido: ${time}`);
  const tokens = normalizeDays(days).map((d) => ISO_TO_SYSTEMD[d]);
  return `${tokens.join(',')} *-*-* ${time}:00`;
}

/**
 * Cálculo de próximos eventos ANCLADO A UNA ZONA HORARIA (default UTC en las
 * firmas para tests deterministas; el service pasa la zona real del servidor,
 * p. ej. `America/Hermosillo`). No usa `Date#setHours`/`getDay`, así que el
 * resultado NO depende de la zona del proceso de Node (que en prod corre en UTC).
 */

/** Offset de la zona (ms) = hora local − UTC, en el instante dado. */
function tzOffsetMs(instant: Date, tz: string): number {
  if (tz === 'UTC') return 0;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/** Convierte un wall-clock (componentes locales en `tz`) al instante UTC real. */
function zonedWallClockToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const guessUtc = Date.UTC(y, mo, d, h, mi, 0);
  const off = tzOffsetMs(new Date(guessUtc), tz);
  return new Date(guessUtc - off);
}

/** Componentes de fecha (wall-clock) de un instante, vistos en `tz`. */
function zonedYmd(instant: Date, tz: string): { year: number; month: number; day: number } {
  if (tz === 'UTC') {
    return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() };
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day };
}

const SYSTEMD_TO_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Día ISO (1=Lun..7=Dom) de un instante, visto en `tz`. */
function isoWeekdayInTz(instant: Date, tz: string): number {
  if (tz === 'UTC') return ((instant.getUTCDay() + 6) % 7) + 1;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(instant);
  return SYSTEMD_TO_ISO[wd] ?? ((instant.getUTCDay() + 6) % 7) + 1;
}

/** Avanza `i` días una fecha de calendario (wall-clock), sin arrastrar la hora. */
function addCalendarDays(ymd: { year: number; month: number; day: number }, i: number) {
  const t = Date.UTC(ymd.year, ymd.month - 1, ymd.day) + i * 86400000;
  const d = new Date(t);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function nextOccurrence(now: Date, days: number[], time: string, tz = 'UTC'): Date | null {
  const norm = normalizeDays(days);
  if (!isValidTime(time)) return null;
  const [h, m] = time.split(':').map(Number);
  const today = zonedYmd(now, tz);
  for (let i = 0; i < 8; i++) {
    const ymd = addCalendarDays(today, i);
    const cand = zonedWallClockToUtc(ymd.year, ymd.month - 1, ymd.day, h, m, tz);
    if (norm.includes(isoWeekdayInTz(cand, tz)) && cand.getTime() >= now.getTime()) return cand;
  }
  return null;
}

export function computeNextEvents(
  now: Date,
  days: number[],
  suspendTime: string,
  wakeTime: string,
  enabled: boolean,
  tz = 'UTC',
): { nextSuspend: Date | null; nextWake: Date | null } {
  if (!enabled) return { nextSuspend: null, nextWake: null };
  const nextSuspend = nextOccurrence(now, days, suspendTime, tz);
  let nextWake: Date | null = null;
  if (nextSuspend && isValidTime(wakeTime)) {
    const [wh, wm] = wakeTime.split(':').map(Number);
    const sYmd = zonedYmd(nextSuspend, tz);
    const wYmd = addCalendarDays(sYmd, 1);
    nextWake = zonedWallClockToUtc(wYmd.year, wYmd.month - 1, wYmd.day, wh, wm, tz);
  }
  return { nextSuspend, nextWake };
}

export function buildDesired(input: {
  enabled: boolean;
  suspendTime: string;
  wakeTime: string;
  days: number[];
}): { enabled: boolean; suspendTime: string; wakeTime: string; days: number[] } {
  if (!isValidTime(input.suspendTime)) throw new Error(`suspendTime inválido: ${input.suspendTime}`);
  if (!isValidTime(input.wakeTime)) throw new Error(`wakeTime inválido: ${input.wakeTime}`);
  return {
    enabled: !!input.enabled,
    suspendTime: input.suspendTime,
    wakeTime: input.wakeTime,
    days: normalizeDays(input.days),
  };
}
