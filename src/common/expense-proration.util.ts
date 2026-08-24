export interface ProratableExpense {
  amount: number | string;
  date: string;                 // 'YYYY-MM-DD'
  periodStart?: string | null;  // 'YYYY-MM-DD' or null
  periodEnd?: string | null;    // 'YYYY-MM-DD' or null
}

const MS_PER_DAY = 86_400_000;

function toUtcMs(day: string): number {
  return Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`);
}

/** Inclusive count of calendar days from startDay to endDay. <= 0 if endDay < startDay. */
export function dayCountInclusive(startDay: string, endDay: string): number {
  return Math.round((toUtcMs(endDay) - toUtcMs(startDay)) / MS_PER_DAY) + 1;
}

function hasPeriod(exp: ProratableExpense): exp is ProratableExpense & { periodStart: string; periodEnd: string } {
  return !!exp.periodStart && !!exp.periodEnd;
}

/** Amount this expense contributes to [rangeStart, rangeEnd] (day strings, inclusive). */
export function proratedAmountInRange(exp: ProratableExpense, rangeStart: string, rangeEnd: string): number {
  const amount = Number(exp.amount || 0);
  if (!hasPeriod(exp)) {
    const d = String(exp.date).slice(0, 10);
    return d >= rangeStart && d <= rangeEnd ? amount : 0;
  }
  const periodDays = dayCountInclusive(exp.periodStart, exp.periodEnd);
  if (periodDays <= 0) return 0;
  const ovStart = exp.periodStart > rangeStart ? exp.periodStart : rangeStart;
  const ovEnd = exp.periodEnd < rangeEnd ? exp.periodEnd : rangeEnd;
  const overlap = dayCountInclusive(ovStart, ovEnd);
  if (overlap <= 0) return 0;
  return (amount * overlap) / periodDays;
}

/**
 * Etiqueta legible del día/rango que el usuario consultó (para la columna "Día consultado"
 * en los reportes). Un solo día -> 'dd/mm/yyyy'; rango -> 'dd/mm/yyyy – dd/mm/yyyy'. Vacío si
 * falta algún extremo. Aclara por qué un gasto recurrente creado fuera del rango aparece.
 */
export function consultedRangeLabel(startDay?: string | null, endDay?: string | null): string {
  if (!startDay || !endDay) return '';
  const fmt = (k: string) => k.slice(0, 10).split('-').reverse().join('/');
  const a = fmt(startDay);
  const b = fmt(endDay);
  return a === b ? a : `${a} – ${b}`;
}

/** This expense's share on a single day. */
export function dailyShareForDay(exp: ProratableExpense, day: string): number {
  const amount = Number(exp.amount || 0);
  if (!hasPeriod(exp)) {
    return String(exp.date).slice(0, 10) === day ? amount : 0;
  }
  if (day < exp.periodStart || day > exp.periodEnd) return 0;
  const periodDays = dayCountInclusive(exp.periodStart, exp.periodEnd);
  if (periodDays <= 0) return 0;
  return amount / periodDays;
}
