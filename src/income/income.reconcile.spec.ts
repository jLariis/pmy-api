// La suite corre en TZ=UTC (ver test/jest.global-setup.js), replicando el server.
// Prueba de RECONCILIACIÓN: el dashboard financiero (`getFinantialDataForDashboard`) y la
// tabla de ingresos (`getIncome`) deben dar EL MISMO total sobre las mismas filas activas,
// incluyendo traslados y ubicando las cargas (00:00Z) en su día local correcto.
import { IncomeService } from './income.service';

const parseMoney = (v: string | number) => Number(String(v ?? '0').replace(/[$,]/g, ''));

const makeIncome = (
  sourceType: string,
  incomeType: string,
  cost: number,
  dateIso: string,
  shipmentType = 'other',
): any => ({ sourceType, incomeType, cost, date: new Date(dateIso), shipmentType, nonDeliveryStatus: null, active: true });

// Repo/chargeRules mockeados: el loader usa createQueryBuilder().getMany(); el ctx usa
// manager.getRepository(Subsidiary).findOne + chargeRules.buildResolver; los gastos usan
// expenseRepository.find. El mock del QB IGNORA el filtro SQL (active/fechas) y devuelve las
// filas dadas — por eso pasamos solo filas activas (el filtro `active=1` lo cubre el SQL).
const buildSvc = (rows: any[]) => {
  const qb: any = {
    leftJoinAndSelect: () => qb,
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    getMany: async () => rows,
  };
  const incomeRepo: any = {
    createQueryBuilder: () => qb,
    manager: {
      getRepository: () => ({ findOne: async () => ({ countTransfersAsIncome: true, secondAbordAmount: 0 }) }),
    },
  };
  const expenseRepo: any = { find: async () => [] };
  const chargeRules: any = { buildResolver: async () => ({ isChargeable: () => undefined }) };
  return new IncomeService(null as any, expenseRepo, null as any, incomeRepo, chargeRules);
};

describe('Reconciliación dashboard financiero ↔ tabla de ingresos', () => {
  // Rango lun 17-08 → dom 22-08 (17 = primer día).
  const from = new Date('2026-08-17T00:00:00.000Z');
  const to = new Date('2026-08-22T00:00:00.000Z');

  const rows = [
    // Carga del primer día (se guarda a 00:00Z, día local 17).
    makeIncome('charge', 'entregado', 4878, '2026-08-17T00:00:00.000Z', 'fedex'),
    // Envío FedEx entregado (instante real, día local 18).
    makeIncome('shipment', 'entregado', 250, '2026-08-18T18:00:00.000Z', 'fedex'),
    // Traslado tyco (anclado a 07:00Z, día local 19).
    makeIncome('tyco', 'tyco', 5472, '2026-08-19T07:00:00.000Z'),
    // Recolección (día local 20).
    makeIncome('collection', 'entregado', 120, '2026-08-20T16:00:00.000Z'),
  ];

  const EXPECTED_TOTAL = 4878 + 250 + 5472 + 120;

  it('finantial.income == suma del desglose diario e incluye traslados', async () => {
    const svc = buildSvc(rows);
    const res = await svc.getFinantialDataForDashboard('sub-1', from, to);

    expect(res.finantial.income).toBe(EXPECTED_TOTAL);

    // Los traslados forman parte del desglose y del total.
    const transferMoney = res.incomes.reduce(
      (s: number, d: any) => s + parseMoney(d.transfers?.totalIncome), 0);
    expect(transferMoney).toBe(5472);

    // La carga del 17 cae en el día 17 (no desaparece).
    const day17 = res.incomes.find((d: any) => d.date === '2026-08-17');
    expect(day17?.cargas).toBe(1);
    expect(parseMoney(day17?.totalIncome)).toBe(4878);
  });

  it('getIncome (tabla) da el MISMO total que el dashboard financiero', async () => {
    const svcTable = buildSvc(rows);
    const { current } = await svcTable.getIncome('sub-1', from, to);
    const tableTotal = current.reduce((s: number, d: any) => s + parseMoney(d.totalIncome), 0);

    expect(tableTotal).toBe(EXPECTED_TOTAL);
  });
});
