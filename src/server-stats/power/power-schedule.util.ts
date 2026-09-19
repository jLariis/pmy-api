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

/** JS getDay: 0=Dom..6=Sáb -> ISO 1=Lun..7=Dom. */
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

export function nextOccurrence(now: Date, days: number[], time: string): Date | null {
  const norm = normalizeDays(days);
  if (!isValidTime(time)) return null;
  const [h, m] = time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (norm.includes(isoWeekday(d)) && d.getTime() >= now.getTime()) return d;
  }
  return null;
}

export function computeNextEvents(
  now: Date,
  days: number[],
  suspendTime: string,
  wakeTime: string,
  enabled: boolean,
): { nextSuspend: Date | null; nextWake: Date | null } {
  if (!enabled) return { nextSuspend: null, nextWake: null };
  const nextSuspend = nextOccurrence(now, days, suspendTime);
  let nextWake: Date | null = null;
  if (nextSuspend && isValidTime(wakeTime)) {
    const [wh, wm] = wakeTime.split(':').map(Number);
    nextWake = new Date(nextSuspend);
    nextWake.setDate(nextWake.getDate() + 1);
    nextWake.setHours(wh, wm, 0, 0);
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
