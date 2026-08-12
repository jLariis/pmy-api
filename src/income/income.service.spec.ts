import { IncomeService } from './income.service';

// formatIncomesNew es autocontenido (no usa `this.<repos>`), así que se puede probar
// instanciando el servicio con dependencias nulas.
const svc = new IncomeService(null as any, null as any, null as any, null as any, null as any);

const makeIncome = (
  sourceType: string,
  incomeType: string,
  cost: number,
  dateIso: string,
  shipmentType = 'other',
): any => ({ sourceType, incomeType, cost, date: new Date(dateIso), shipmentType, nonDeliveryStatus: null });

// Suma TZ-independiente sobre todos los días del rango (evita depender del día exacto).
const sumMoney = (report: any[], bucket: string) =>
  report.reduce((s, d) => s + Number(String(d[bucket]?.totalIncome ?? '0').replace(/[$,]/g, '')), 0);
const sumCount = (report: any[], bucket: string) =>
  report.reduce((n, d) => n + (d[bucket]?.total ?? 0), 0);

describe('IncomeService.formatIncomesNew — bucket de traslados', () => {
  const from = new Date('2026-07-14T00:00:00Z');
  const to = new Date('2026-07-17T00:00:00Z');

  it('expone un bucket `transfers` con conteo e ingreso, sumado al total del día', async () => {
    const incomes = [
      makeIncome('tyco', 'tyco', 4878, '2026-07-15T07:00:00.000Z'),
      makeIncome('aeropuerto', 'aeropuerto', 5472, '2026-07-15T07:00:00.000Z'),
    ];
    const report = await svc.formatIncomesNew(incomes, from, to, { countTransfers: true });

    expect(sumCount(report, 'transfers')).toBe(2);
    expect(sumMoney(report, 'transfers')).toBe(4878 + 5472);
    // El dinero de traslados debe formar parte del totalIncome del día.
    expect(sumMoney(report, 'transfers')).toBeGreaterThan(0);
    const grandTotal = report.reduce(
      (s, d: any) => s + Number(String(d.totalIncome ?? '0').replace(/[$,]/g, '')), 0);
    expect(grandTotal).toBe(4878 + 5472);
  });

  it('con countTransfers=false el bucket cuenta operaciones pero NO suma dinero', async () => {
    const incomes = [makeIncome('tyco', 'tyco', 4878, '2026-07-15T07:00:00.000Z')];
    const report = await svc.formatIncomesNew(incomes, from, to, { countTransfers: false });
    expect(sumCount(report, 'transfers')).toBe(1);
    expect(sumMoney(report, 'transfers')).toBe(0);
  });
});
