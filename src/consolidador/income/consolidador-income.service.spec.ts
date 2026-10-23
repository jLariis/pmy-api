import { ConsolidadorIncomeService } from './consolidador-income.service';

const auditStub: any = { record: async () => undefined };
const noShipmentRepo: any = { findOne: async () => null };
const chargeRulesStub: any = { buildResolver: async () => ({ isChargeable: () => undefined }) };

function makeService(income: any, subsidiary: any = { id: 'sub', secondAbordAmount: 594, chargeSecondAbord: true }) {
  const incomeRepo: any = {
    findOne: async () => income,
    save: async (x: any) => x,
  };
  const subsidiaryRepo: any = { findOne: async () => subsidiary };
  return new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, auditStub, noShipmentRepo, chargeRulesStub);
}

/** Service para probar createManual: controla el resultado del findOne de duplicados y captura el create. */
function makeCreateService(existingDuplicate: any = null, shipment: any = null) {
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
  const shipmentRepo: any = { findOne: async () => shipment };
  const svc = new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, auditStub, shipmentRepo, chargeRulesStub);
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
    const svc = new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, audit, noShipmentRepo, chargeRulesStub);
    await svc.editCost('i1', 4000, 'ajuste', 'user-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'cost_edit', field: 'cost', oldValue: 4594, newValue: 4000, userId: 'user-1' });
  });
});

describe('ConsolidadorIncomeService.deleteIncome', () => {
  it('marca active=false y registra historial de borrado', async () => {
    const calls: any[] = [];
    const audit: any = { record: async (e: any) => calls.push(e) };
    const income: any = { id: 'i1', cost: '100', active: true, date: new Date(), charge: null, shipment: { id: 's1' } };
    const incomeRepo: any = { findOne: async () => income, save: async (x: any) => x };
    const subsidiaryRepo: any = { findOne: async () => ({ id: 'sub' }) };
    const svc = new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, audit, noShipmentRepo, chargeRulesStub);
    const res = await svc.deleteIncome('i1', 'duplicado', 'user-1');
    expect(income.active).toBe(false);
    expect(income.annulledById).toBe('user-1');
    expect(res).toEqual({ id: 'i1', deleted: true });
    expect(calls[0]).toMatchObject({ action: 'delete', field: 'active', newValue: '0', userId: 'user-1' });
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

describe('ConsolidadorIncomeService.createManual — liga a la guía (caso 878249671370)', () => {
  it('"Manual (otro)" con guía existente se guarda como ingreso de la guía y queda ligado', async () => {
    const { svc, getCreated } = makeCreateService(null, { id: 'sh-nuevo', shipmentType: 'fedex' });
    await svc.createManual(
      { subsidiaryId: 'hmo', kind: 'manual', trackingNumber: '878249671370', cost: 52, date: '2026-10-10', reason: 'no se generó en el cierre' },
      'user-1',
    );
    const created = getCreated();
    expect(created.sourceType).toBe('shipment');
    expect(created.incomeType).toBe('entregado');
    expect(created.shipmentType).toBe('fedex');
    expect(created.shipment).toEqual({ id: 'sh-nuevo' });
  });

  it('"Manual (otro)" sin guía en el sistema se queda como manual', async () => {
    const { svc, getCreated } = makeCreateService(null, null);
    await svc.createManual(
      { subsidiaryId: 'hmo', kind: 'manual', trackingNumber: 'X1', cost: 10, date: '2026-10-10', reason: 'otro' },
      'user-1',
    );
    expect(getCreated().sourceType).toBe('manual');
    expect(getCreated().shipment).toBeUndefined();
  });
});

describe('ConsolidadorIncomeService.createManual — DEX igual que el automático', () => {
  it('DEX se guarda como no_entregado con código 08', async () => {
    const { svc, getCreated } = makeCreateService(null, { id: 'sh-1', shipmentType: 'fedex' });
    await svc.createManual(
      { subsidiaryId: 'hmo', kind: 'dex', trackingNumber: '771234500018', cost: 40, date: '2026-10-20', reason: '3ra visita' },
      'user-1',
    );
    expect(getCreated().incomeType).toBe('no_entregado');
    expect(getCreated().nonDeliveryStatus).toBe('08');
  });
});

describe('ConsolidadorIncomeService.createManual — DEX07', () => {
  it('DEX07 se guarda como no_entregado con código 07 y busca duplicado del mismo código', async () => {
    let dupWhere: any = null;
    let created: any = null;
    const incomeRepo: any = {
      findOne: async (q: any) => { dupWhere = q.where; return null; },
      create: (x: any) => (created = { ...x, id: 'n1' }),
      save: async (x: any) => x,
    };
    const svc = new ConsolidadorIncomeService(incomeRepo, { findOne: async () => ({}) } as any, auditStub, { findOne: async () => ({ id: 'sh', shipmentType: 'fedex' }) } as any, chargeRulesStub);
    await svc.createManual({ subsidiaryId: 'hmo', kind: 'dex07', trackingNumber: '384068513928', cost: 52, date: '2026-10-16', reason: 'rechazo del 16' }, 'u1');
    expect(created).toMatchObject({ incomeType: 'no_entregado', nonDeliveryStatus: '07', shipment: { id: 'sh' } });
    expect(dupWhere).toMatchObject({ incomeType: 'no_entregado', nonDeliveryStatus: '07', active: true });
  });
});

describe('ConsolidadorIncomeService.previewManual', () => {
  function makePreviewService(opts: { shipment?: any; sameDay?: any; chargeable?: boolean | undefined } = {}) {
    const incomeRepo: any = { findOne: async () => opts.sameDay ?? null };
    const subsidiaryRepo: any = { findOne: async () => ({ id: 'hmo', countTransfersAsIncome: true, fedexCostPackage: '52.00', dhlCostPackage: '45.00' }) };
    const shipmentRepo: any = { findOne: async () => opts.shipment ?? null };
    const rules: any = { buildResolver: async () => ({ isChargeable: () => opts.chargeable }) };
    return new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo, auditStub, shipmentRepo, rules);
  }

  it('"Otro" sin guía → columna Otros, suma, sin monto sugerido', async () => {
    const p = await makePreviewService().previewManual({ subsidiaryId: 'hmo', kind: 'manual', date: '2026-10-20' });
    expect(p).toMatchObject({ shipment: null, sourceType: 'manual', column: 'otros', countable: true, suggestedCost: null });
  });

  it('DEX de guía DHL → columna DHL con la tarifa DHL de la sucursal', async () => {
    const shipment = { id: 'sh', shipmentType: 'dhl', status: 'no_entregado', subsidiary: { id: 'hmo', name: 'Hermosillo' } };
    const p = await makePreviewService({ shipment, chargeable: true }).previewManual({
      subsidiaryId: 'hmo', kind: 'dex', trackingNumber: '1234567890', date: '2026-10-20',
    });
    expect(p).toMatchObject({
      column: 'dhl', countable: true, suggestedCost: 45, nonDeliveryStatus: '08',
      shipment: { carrier: 'dhl', subsidiaryName: 'Hermosillo' },
    });
  });

  it('avisa cuando la regla de cobro de la sucursal no cobra', async () => {
    const shipment = { id: 'sh', shipmentType: 'fedex', status: 'entregado', subsidiary: { id: 'hmo', name: 'Hermosillo' } };
    const p = await makePreviewService({ shipment, chargeable: false }).previewManual({
      subsidiaryId: 'hmo', kind: 'pod', trackingNumber: 'T1', date: '2026-10-20',
    });
    expect(p.countable).toBe(false);
  });

  it('reporta el ingreso de esa guía ese mismo día', async () => {
    const p = await makePreviewService({ sameDay: { cost: '52.00', sourceType: 'shipment', incomeType: 'entregado' } }).previewManual({
      subsidiaryId: 'hmo', kind: 'pod', trackingNumber: 'T1', date: '2026-10-20',
    });
    expect(p.sameDayIncome).toEqual({ cost: 52, sourceType: 'shipment', incomeType: 'entregado' });
  });
});
