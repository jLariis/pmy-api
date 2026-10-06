import {
  dayCountInclusive,
  proratedAmountInRange,
  dailyShareForDay,
  consultedRangeLabel,
  ProratableExpense,
  normalizePeriodEnd,
  suggestedPeriodEnd,
} from './expense-proration.util';

describe('expense-proration', () => {
  it('dayCountInclusive counts both ends', () => {
    expect(dayCountInclusive('2026-06-27', '2026-07-03')).toBe(7);
    expect(dayCountInclusive('2026-07-01', '2026-07-01')).toBe(1);
    expect(dayCountInclusive('2026-07-03', '2026-07-01')).toBeLessThanOrEqual(0);
  });

  const payroll: ProratableExpense = {
    amount: 7000, date: '2026-07-04', periodStart: '2026-06-27', periodEnd: '2026-07-03',
  };

  it('prorates by overlap with the query range', () => {
    // 7-day period, $7000 => $1000/day. July range overlaps Jul 1-3 = 3 days => 3000.
    expect(proratedAmountInRange(payroll, '2026-07-01', '2026-07-31')).toBeCloseTo(3000, 6);
    // June range overlaps Jun 27-30 = 4 days => 4000.
    expect(proratedAmountInRange(payroll, '2026-06-01', '2026-06-30')).toBeCloseTo(4000, 6);
    // No overlap => 0.
    expect(proratedAmountInRange(payroll, '2026-08-01', '2026-08-31')).toBe(0);
  });

  it('daily share is amount / periodDays on covered days, 0 otherwise', () => {
    expect(dailyShareForDay(payroll, '2026-07-02')).toBeCloseTo(1000, 6);
    expect(dailyShareForDay(payroll, '2026-07-04')).toBe(0); // registration day, outside period
    expect(dailyShareForDay(payroll, '2026-06-27')).toBeCloseTo(1000, 6);
  });

  it('point expense (no period) lands fully on its date', () => {
    const fuel: ProratableExpense = { amount: 450, date: '2026-07-02' };
    expect(proratedAmountInRange(fuel, '2026-07-01', '2026-07-31')).toBe(450);
    expect(proratedAmountInRange(fuel, '2026-08-01', '2026-08-31')).toBe(0);
    expect(dailyShareForDay(fuel, '2026-07-02')).toBe(450);
    expect(dailyShareForDay(fuel, '2026-07-03')).toBe(0);
  });

  it('INVARIANT: sum of daily shares over a range equals proratedAmountInRange', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
    const sum = days.reduce((s, d) => s + dailyShareForDay(payroll, d), 0);
    expect(sum).toBeCloseTo(proratedAmountInRange(payroll, '2026-07-01', '2026-07-05'), 6);
  });

  it('consultedRangeLabel: single date when start equals end', () => {
    expect(consultedRangeLabel('2026-08-20', '2026-08-20')).toBe('20/08/2026');
  });

  it('consultedRangeLabel: dd/mm/yyyy range when start differs from end', () => {
    expect(consultedRangeLabel('2026-08-14', '2026-08-20')).toBe('14/08/2026 – 20/08/2026');
  });

  it('consultedRangeLabel: empty string when a bound is missing', () => {
    expect(consultedRangeLabel(null, '2026-08-20')).toBe('');
  });
});

describe('normalizePeriodEnd (convención "fecha a fecha")', () => {
  it('semana capturada vie→vie (8 días) se recorta a 7', () => {
    expect(normalizePeriodEnd('Semanal', '2026-08-14', '2026-08-21')).toBe('2026-08-20');
  });
  it('mes capturado 27→27 (32 días) se recorta al día anterior', () => {
    expect(normalizePeriodEnd('Mensual', '2026-07-27', '2026-08-27')).toBe('2026-08-26');
  });
  it('mes de 30 días capturado 1→1 se recorta a 30', () => {
    expect(normalizePeriodEnd('Mensual', '2026-09-01', '2026-10-01')).toBe('2026-09-30');
  });
  it('fin de mes: 31 ene → 28 feb (mismo "día" ajustado) se recorta', () => {
    expect(normalizePeriodEnd('Mensual', '2026-01-31', '2026-02-28')).toBe('2026-02-27');
  });
  it('año capturado fecha a fecha se recorta', () => {
    expect(normalizePeriodEnd('Anual', '2026-03-10', '2027-03-10')).toBe('2027-03-09');
  });
  it('periodos ya correctos no cambian', () => {
    expect(normalizePeriodEnd('Semanal', '2026-08-14', '2026-08-20')).toBe('2026-08-20');
    expect(normalizePeriodEnd('Mensual', '2026-09-01', '2026-09-30')).toBe('2026-09-30');
    expect(normalizePeriodEnd('Mensual', '2026-08-01', '2026-08-31')).toBe('2026-08-31');
    expect(normalizePeriodEnd('Semanal', '2026-08-21', '2026-08-24')).toBe('2026-08-24');
  });
  it('otras frecuencias no se tocan', () => {
    expect(normalizePeriodEnd('Diario', '2026-08-14', '2026-08-21')).toBe('2026-08-21');
    expect(normalizePeriodEnd(undefined, '2026-08-14', '2026-08-21')).toBe('2026-08-21');
  });
});

describe('suggestedPeriodEnd', () => {
  it('calcula el último día incluido del periodo', () => {
    expect(suggestedPeriodEnd('Semanal', '2026-09-28')).toBe('2026-10-04');
    expect(suggestedPeriodEnd('Mensual', '2026-09-01')).toBe('2026-09-30');
    expect(suggestedPeriodEnd('Mensual', '2026-07-27')).toBe('2026-08-26');
    expect(suggestedPeriodEnd('Anual', '2026-03-10')).toBe('2027-03-09');
    expect(suggestedPeriodEnd('Diario', '2026-03-10')).toBeNull();
  });
});
