import { IncomeExecutor } from './income-executor';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

describe('IncomeExecutor', () => {
  it('report: NO inserta; marca exists según sourceEventKey', async () => {
    const incomeRepo = { findOne: jest.fn().mockResolvedValue({ id: 'i1' }) };
    const subRepo = { findOne: jest.fn().mockResolvedValue({ fedexCostPackage: 50 }) };
    const ds: any = {
      getRepository: (e: any) => (e?.name === 'Income' ? incomeRepo : subRepo),
      transaction: jest.fn(),
    };
    const exec = new IncomeExecutor(ds);
    const effects = [{ type: 'income', payload: { eventKey: 'k1', incomeType: IncomeStatus.ENTREGADO, occurredAt: new Date(), trackingNumber: 'T1', shipmentId: 's1', subsidiaryId: 'sub1' } }];
    const out = await exec.execute(effects as any, 'report');
    expect(out).toHaveLength(1);
    expect(out[0].exists).toBe(true);
    expect(out[0].cost).toBe(50);
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it('persist: inserta el ingreso faltante anclado al eventKey', async () => {
    const saved: any[] = [];
    const m = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((_e, x) => x),
      save: jest.fn(async (_e, x) => { saved.push(x); return x; }),
    };
    const ds: any = {
      getRepository: (e: any) => (e?.name === 'Income'
        ? { findOne: jest.fn().mockResolvedValue(null) }
        : { findOne: jest.fn().mockResolvedValue({ fedexCostPackage: 50 }) }),
      transaction: async (fn: any) => fn(m),
    };
    const exec = new IncomeExecutor(ds);
    const effects = [{ type: 'income', payload: { eventKey: 'k2', incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: new Date(), trackingNumber: 'T2', shipmentId: 's2', subsidiaryId: 'sub1', exceptionCode: '07' } }];
    const out = await exec.execute(effects as any, 'persist');
    expect(out[0].exists).toBe(false);
    expect(saved.some((s) => s.sourceEventKey === 'k2' && s.cost === 50)).toBe(true);
  });

  it('persist: costo 0 no inserta (FINANCE_ERROR)', async () => {
    const m = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    const ds: any = {
      getRepository: (e: any) => (e?.name === 'Income'
        ? { findOne: jest.fn().mockResolvedValue(null) }
        : { findOne: jest.fn().mockResolvedValue({ fedexCostPackage: 0 }) }),
      transaction: async (fn: any) => fn(m),
    };
    const exec = new IncomeExecutor(ds);
    const effects = [{ type: 'income', payload: { eventKey: 'k3', incomeType: IncomeStatus.ENTREGADO, occurredAt: new Date(), trackingNumber: 'T3', shipmentId: 's3', subsidiaryId: 'sub0' } }];
    const out = await exec.execute(effects as any, 'persist');
    expect(out[0].cost).toBe(0);
    expect(m.save).not.toHaveBeenCalled();
  });
});
