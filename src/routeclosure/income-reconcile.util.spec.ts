import { reconcileShipmentIncomeAction } from './income-reconcile.util';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

const entregado = { incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null };
const dex07 = { incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: '07' };

describe('reconcileShipmentIncomeAction', () => {
  it('decisión null (en tránsito / sin resolver) → none', () => {
    expect(reconcileShipmentIncomeAction({ decision: null, deliveryDay: '2026-08-12', existing: { entregado: false } }))
      .toEqual({ type: 'none' });
  });

  it('ENTREGADO + DEX del MISMO día (sin ENTREGADO previo) → supersede la fila del DEX', () => {
    expect(reconcileShipmentIncomeAction({
      decision: entregado,
      deliveryDay: '2026-08-12',
      existing: { entregado: false, dex: { id: 'INC-DEX', day: '2026-08-12' } },
    })).toEqual({ type: 'supersede', incomeId: 'INC-DEX' });
  });

  it('ENTREGADO + DEX de OTRO día → create ENTREGADO (se conserva el DEX)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: entregado,
      deliveryDay: '2026-08-13',
      existing: { entregado: false, dex: { id: 'INC-DEX', day: '2026-08-12' } },
    })).toEqual({ type: 'create', incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null });
  });

  it('ENTREGADO + ya existe ENTREGADO → none (idempotente)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: entregado, deliveryDay: '2026-08-12', existing: { entregado: true },
    })).toEqual({ type: 'none' });
  });

  it('ENTREGADO + ya ENTREGADO + DEX rezagado del mismo día → none (no duplica ENTREGADO)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: entregado,
      deliveryDay: '2026-08-12',
      existing: { entregado: true, dex: { id: 'INC-DEX', day: '2026-08-12' } },
    })).toEqual({ type: 'none' });
  });

  it('ENTREGADO sin ningún ingreso → create ENTREGADO (backfill)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: entregado, deliveryDay: '2026-08-12', existing: { entregado: false },
    })).toEqual({ type: 'create', incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null });
  });

  it('DEX sin ningún ingreso → create NO_ENTREGADO con el código (backfill)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07, deliveryDay: '2026-08-12', existing: { entregado: false },
    })).toEqual({ type: 'create', incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: '07' });
  });

  it('DEX + ya existe ENTREGADO → none (no degrada el ENTREGADO)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07, deliveryDay: '2026-08-12', existing: { entregado: true },
    })).toEqual({ type: 'none' });
  });

  it('DEX + ya existe un DEX → none (idempotente)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07,
      deliveryDay: '2026-08-12',
      existing: { entregado: false, dex: { id: 'INC-DEX', day: '2026-08-12' } },
    })).toEqual({ type: 'none' });
  });
});

describe('reconcileShipmentIncomeAction — DEX de otra semana', () => {
  // Igual que el cron: un DEX ya cobrado solo bloquea otro DEX de su MISMA semana (lun–dom).
  it('DEX + DEX previo de OTRA semana → create (es otro cobro)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07,
      deliveryDay: '2026-07-16',
      existing: { entregado: false, dex: { id: 'INC-DEX', day: '2026-07-07' }, dexDays: ['2026-07-07'] },
    })).toEqual({ type: 'create', incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: '07' });
  });

  it('DEX + DEX previo de la MISMA semana (otro día) → none', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07,
      deliveryDay: '2026-07-12', // domingo
      existing: { entregado: false, dex: { id: 'INC-DEX', day: '2026-07-06' }, dexDays: ['2026-07-06'] }, // lunes
    })).toEqual({ type: 'none' });
  });

  it('DEX + DEX previo sin día del evento → none (no arriesga doble cobro)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07,
      deliveryDay: null,
      existing: { entregado: false, dex: { id: 'INC-DEX', day: '2026-07-07' }, dexDays: ['2026-07-07'] },
    })).toEqual({ type: 'none' });
  });

  it('DEX de otra semana pero ya hay ENTREGADO → none (no degrada)', () => {
    expect(reconcileShipmentIncomeAction({
      decision: dex07,
      deliveryDay: '2026-07-16',
      existing: { entregado: true, dex: { id: 'INC-DEX', day: '2026-07-07' }, dexDays: ['2026-07-07'] },
    })).toEqual({ type: 'none' });
  });
});
