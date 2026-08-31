import { CobrosReconciliationService } from './cobros-reconciliation.service';

describe('CobrosReconciliationService', () => {
  it('cuenta entregados y detecta missing/orphan', async () => {
    const calls: string[] = [];
    const ds: any = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('COUNT(*)')) { calls.push('count'); return [{ c: 10 }]; }
        if (sql.includes('i.id IS NULL')) { calls.push('missing'); return [{ tn: 'A' }, { tn: 'B' }]; }
        if (sql.includes('s.status) <> ')) { calls.push('orphan'); return [{ tn: 'C' }]; }
        return [];
      }),
    };
    const svc = new CobrosReconciliationService(ds);
    const r = await svc.reconcile(14);
    expect(r.deliveredShipments).toBe(10);
    expect(r.missingIncome).toEqual(['A', 'B']);
    expect(r.orphanIncome).toEqual(['C']);
    expect(r.missingCount).toBe(2);
    expect(r.orphanCount).toBe(1);
    expect(calls).toEqual(['count', 'missing', 'orphan']);
  });

  it('sin discrepancias → contadores en 0', async () => {
    const ds: any = { query: jest.fn(async (sql: string) => (sql.includes('COUNT(*)') ? [{ c: 5 }] : [])) };
    const svc = new CobrosReconciliationService(ds);
    const r = await svc.reconcile();
    expect(r.deliveredShipments).toBe(5);
    expect(r.missingCount).toBe(0);
    expect(r.orphanCount).toBe(0);
  });
});
