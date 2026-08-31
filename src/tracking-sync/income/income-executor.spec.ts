import { IncomeExecutor } from './income-executor';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

function makeDs(opts: { existing?: any; subCost?: number; onUpdate?: jest.Mock; onSave?: jest.Mock }) {
  const incomeRepo = {
    findOne: jest.fn().mockResolvedValue(opts.existing ?? null),
    update: opts.onUpdate ?? jest.fn(),
  };
  const subRepo = { findOne: jest.fn().mockResolvedValue({ fedexCostPackage: opts.subCost ?? 50 }) };
  const m = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_e, x) => x),
    save: opts.onSave ?? jest.fn(async (_e, x) => x),
  };
  return {
    getRepository: (e: any) => (e?.name === 'Income' ? incomeRepo : subRepo),
    transaction: async (fn: any) => fn(m),
    _income: incomeRepo, _m: m,
  } as any;
}

const effect = (over: any = {}) => ([{
  type: 'income',
  payload: {
    eventKey: over.k ?? 'k1', incomeType: over.type ?? IncomeStatus.ENTREGADO, occurredAt: new Date('2026-08-19T10:00:00'),
    trackingNumber: 'T1', shipmentId: 's1', subsidiaryId: 'sub1', exceptionCode: over.ec,
  },
}]);

describe('IncomeExecutor (dedup por semana + upgrade)', () => {
  it('report: NO escribe; exists refleja ingreso de la semana', async () => {
    const ds = makeDs({ existing: { id: 'i1', incomeType: IncomeStatus.ENTREGADO } });
    const out = await new IncomeExecutor(ds).execute(effect() as any, 'report');
    expect(out[0].exists).toBe(true);
    expect(ds._income.update).not.toHaveBeenCalled();
    expect(ds._m.save).not.toHaveBeenCalled();
  });

  it('persist: sin ingreso esa semana → crea', async () => {
    const onSave = jest.fn(async (_e, x) => x);
    const ds = makeDs({ existing: null, onSave });
    await new IncomeExecutor(ds).execute(effect({ type: IncomeStatus.NO_ENTREGADO, ec: '07' }) as any, 'persist');
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][1].sourceEventKey).toBe('k1');
  });

  it('persist: ya existe ENTREGADO → no hace nada', async () => {
    const ds = makeDs({ existing: { id: 'i1', incomeType: IncomeStatus.ENTREGADO } });
    await new IncomeExecutor(ds).execute(effect({ type: IncomeStatus.ENTREGADO }) as any, 'persist');
    expect(ds._income.update).not.toHaveBeenCalled();
    expect(ds._m.save).not.toHaveBeenCalled();
  });

  it('persist: existe NO_ENTREGADO y llega ENTREGADO → UPGRADE (no duplica)', async () => {
    const onUpdate = jest.fn();
    const ds = makeDs({ existing: { id: 'i9', incomeType: IncomeStatus.NO_ENTREGADO }, onUpdate });
    await new IncomeExecutor(ds).execute(effect({ type: IncomeStatus.ENTREGADO }) as any, 'persist');
    expect(onUpdate).toHaveBeenCalledWith({ id: 'i9' }, expect.objectContaining({ incomeType: IncomeStatus.ENTREGADO }));
    expect(ds._m.save).not.toHaveBeenCalled(); // no crea otro
  });

  it('persist: existe NO_ENTREGADO y llega NO_ENTREGADO → no duplica', async () => {
    const ds = makeDs({ existing: { id: 'i9', incomeType: IncomeStatus.NO_ENTREGADO } });
    await new IncomeExecutor(ds).execute(effect({ type: IncomeStatus.NO_ENTREGADO, ec: '08' }) as any, 'persist');
    expect(ds._income.update).not.toHaveBeenCalled();
    expect(ds._m.save).not.toHaveBeenCalled();
  });

  it('persist: costo 0 no inserta (FINANCE_ERROR)', async () => {
    const onSave = jest.fn();
    const ds = makeDs({ existing: null, subCost: 0, onSave });
    await new IncomeExecutor(ds).execute(effect() as any, 'persist');
    expect(onSave).not.toHaveBeenCalled();
  });
});
