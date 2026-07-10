import {
  dayCountInclusive,
  proratedAmountInRange,
  dailyShareForDay,
  ProratableExpense,
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
});
