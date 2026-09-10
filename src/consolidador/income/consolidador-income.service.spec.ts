import { ConsolidadorIncomeService } from './consolidador-income.service';

const auditStub: any = { record: async () => undefined };

function makeService(income: any, subsidiary: any = { id: 'sub', secondAbordAmount: 594, chargeSecondAbord: true }) {
  const incomeRepo: any = {
    findOne: async () => income,
    save: async (x: any) => x,
  };
  const subsidiaryRepo: any = { findOne: async () => subsidiary };
  return new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, auditStub);
}

/** Service para probar createManual: controla el resultado del findOne de duplicados y captura el create. */
function makeCreateService(existingDuplicate: any = null) {
  let created: any = null;
  const incomeRepo: any = {
    findOne: async () => existingDuplicate,
    create: (x: any) => {
      created = { ...x, id: 'new-1' };
      return created;
    },
    save: async (x: any) => x,
  };
  const subsidiaryRepo: any = { findOne: async () => ({ id: 'sub' }) };
  const svc = new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, auditStub);
  return { svc, getCreated: () => created };
}

describe('ConsolidadorIncomeService.editCost', () => {
  it('guarda originalCost en el 1er ajuste y estampa quién/motivo', async () => {
    const income: any = {
      id: 'i1', cost: '4594', originalCost: null, sourceType: 'charge', incomeType: 'entregado',
      date: new Date(), charge: { consNumber: 'CN' }, shipment: null,
    };
    const svc = makeService(income);
    const row = await svc.editCost('i1', 4000, 'ajuste', 'user-1');
    expect(income.originalCost).toBe(4594);
    expect(income.cost).toBe(4000);
    expect(income.updatedById).toBe('user-1');
    expect(income.editReason).toBe('ajuste');
    expect(row.cost).toBe(4000);
  });

  it('no pisa originalCost en un segundo ajuste', async () => {
    const income: any = { id: 'i1', cost: '4000', originalCost: '4594', date: new Date(), charge: null, shipment: null };
    const svc = makeService(income);
    await svc.editCost('i1', 3500, 'otro', 'user-2');
    expect(Number(income.originalCost)).toBe(4594);
    expect(income.cost).toBe(3500);
  });
});

describe('ConsolidadorIncomeService.setSecondAbord', () => {
  it('quita el 2º a bordo cuando la sucursal lo incluye por defecto', async () => {
    const income: any = { id: 'i1', cost: '4594', originalCost: null, secondAbordApplied: null, date: new Date(), charge: null, shipment: null };
    const svc = makeService(income); // chargeSecondAbord: true → alreadyIncluded
    await svc.setSecondAbord('i1', false, 'sin 2º', 'user-1');
    expect(income.cost).toBe(4000);
    expect(income.secondAbordApplied).toBe(false);
  });

  it('toggle idempotente usando el estado persistido', async () => {
    const income: any = { id: 'i1', cost: '4000', originalCost: '4594', secondAbordApplied: false, date: new Date(), charge: null, shipment: null };
    const svc = makeService(income);
    // Ya está en false; pedir false de nuevo no cambia el costo.
    await svc.setSecondAbord('i1', false, 'sin 2º', 'user-1');
    expect(income.cost).toBe(4000);
    // Ponerlo de vuelta suma una sola vez.
    await svc.setSecondAbord('i1', true, 'con 2º', 'user-1');
    expect(income.cost).toBe(4594);
    expect(income.secondAbordApplied).toBe(true);
  });
});

describe('ConsolidadorIncomeService auditoría', () => {
  it('editCost registra una fila de historial con antes/después', async () => {
    const calls: any[] = [];
    const audit: any = { record: async (e: any) => calls.push(e) };
    const income: any = { id: 'i1', cost: '4594', originalCost: null, date: new Date(), charge: null, shipment: { id: 's1' } };
    const incomeRepo: any = { findOne: async () => income, save: async (x: any) => x };
    const subsidiaryRepo: any = { findOne: async () => ({ id: 'sub' }) };
    const svc = new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, audit);
    await svc.editCost('i1', 4000, 'ajuste', 'user-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'cost_edit', field: 'cost', oldValue: 4594, newValue: 4000, userId: 'user-1' });
  });
});

describe('ConsolidadorIncomeService.createManual', () => {
  it('crea income de recolección con sourceType/incomeType mapeados', async () => {
    const { svc, getCreated } = makeCreateService(null);
    await svc.createManual(
      { subsidiaryId: 'sub', kind: 'recoleccion', trackingNumber: 'T1', cost: 120, date: '2026-09-09', reason: 'cobro' },
      'user-1',
    );
    const created = getCreated();
    expect(created.sourceType).toBe('collection');
    expect(created.incomeType).toBe('entregado');
    expect(created.cost).toBe(120);
    expect(created.createdById).toBe('user-1');
    expect(created.editReason).toBe('cobro');
  });

  it('lanza conflicto si ya existe un ingreso equivalente ese día', async () => {
    const { svc } = makeCreateService({ id: 'dup' });
    await expect(
      svc.createManual(
        { subsidiaryId: 'sub', kind: 'pod', trackingNumber: 'T1', cost: 100, date: '2026-09-09', reason: 'pod' },
        'user-1',
      ),
    ).rejects.toThrow('Ya existe');
  });
});
