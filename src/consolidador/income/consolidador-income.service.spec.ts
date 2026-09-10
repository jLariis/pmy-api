import { ConsolidadorIncomeService } from './consolidador-income.service';

function makeService(income: any, subsidiary: any = { id: 'sub', secondAbordAmount: 594, chargeSecondAbord: true }) {
  const incomeRepo: any = {
    findOne: async () => income,
    save: async (x: any) => x,
  };
  const subsidiaryRepo: any = { findOne: async () => subsidiary };
  return new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo);
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
