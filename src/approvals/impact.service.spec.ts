import { ApprovalImpactService } from './impact.service';

const consRepo = () => ({ findOne: async () => ({ id: 'c1', consNumber: 'CONS-1', subsidiary: { id: 's1' }, createdBy: { name: 'Ada' } }) }) as any;
const dispatchRepo = () => ({ findOne: async () => null }) as any;
// count() calls resolve in declared order via a queue
function countRepo(values: number[]) {
  let i = 0;
  return { count: async () => values[i++] ?? 0 } as any;
}
// Income repo whose QueryBuilder chain resolves getCount() to a fixed value.
function incomeRepo(withIncome: number) {
  const qb: any = {
    leftJoin: () => qb,
    where: () => qb,
    getCount: async () => withIncome,
  };
  return { createQueryBuilder: () => qb } as any;
}

describe('ApprovalImpactService.build (consolidado)', () => {
  it('aggregates shipment/charge/en-ruta/income counts', async () => {
    const svc = new ApprovalImpactService(
      consRepo(), dispatchRepo(),
      countRepo([10, 2]),        // shipmentRepo: total, enRuta
      countRepo([3, 1]),         // chargeRepo: total, enRuta
      incomeRepo(4),             // incomeRepo: withIncome
      { findOne: async () => null } as any, // routeClosureRepo (unused for consolidado)
    );
    const impact = await svc.build('delete_consolidado', 'c1');
    expect(impact.counts.shipments).toBe(10);
    expect(impact.counts.charges).toBe(3);
    expect(impact.counts.enRuta).toBe(2 + 1);
    expect(impact.counts.withIncome).toBe(4);
    expect(impact.createdByName).toBe('Ada');
    expect(impact.subsidiaryId).toBe('s1');
  });
});
