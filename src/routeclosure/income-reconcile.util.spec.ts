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
