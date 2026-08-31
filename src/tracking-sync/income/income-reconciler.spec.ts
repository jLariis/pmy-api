import { IncomeReconciler } from './income-reconciler';

describe('IncomeReconciler', () => {
  it('clasifica missing vs ya-existe', async () => {
    const exec: any = {
      execute: jest.fn().mockResolvedValue([
        { trackingNumber: 'A', incomeType: 'entregado', sourceEventKey: 'k1', cost: 50, exists: false, occurredAt: new Date(), subsidiaryId: 's', shipmentId: 'x' },
        { trackingNumber: 'B', incomeType: 'entregado', sourceEventKey: 'k2', cost: 50, exists: true, occurredAt: new Date(), subsidiaryId: 's', shipmentId: 'y' },
      ]),
    };
    const rec = new IncomeReconciler(exec);
    const r = await rec.reconcile([{ type: 'income', payload: {} }] as any);
    expect(exec.execute).toHaveBeenCalledWith(expect.anything(), 'report');
    expect(r.missingCount).toBe(1);
    expect(r.okCount).toBe(1);
    expect(r.rows.find((x) => x.trackingNumber === 'A')!.missing).toBe(true);
    expect(r.rows.find((x) => x.trackingNumber === 'B')!.alreadyExists).toBe(true);
  });

  it('sin efectos → vacío', async () => {
    const exec: any = { execute: jest.fn().mockResolvedValue([]) };
    const rec = new IncomeReconciler(exec);
    const r = await rec.reconcile([]);
    expect(r.rows).toHaveLength(0);
    expect(r.missingCount).toBe(0);
  });
});
