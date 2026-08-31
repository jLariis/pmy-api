import { TrackingSyncController } from './tracking-sync.controller';

describe('TrackingSyncController', () => {
  const compare = {
    compareByTracking: jest.fn().mockResolvedValue({ trackingNumber: 'TN1' }),
    compareByRoute: jest.fn().mockResolvedValue([]),
    compareByConsolidated: jest.fn().mockResolvedValue([]),
    applyMany: jest.fn().mockResolvedValue([]),
  } as any;
  const cobrosRecon = {
    reconcile: jest.fn().mockResolvedValue({ windowDays: 14, deliveredShipments: 0, missingIncome: [], orphanIncome: [], missingCount: 0, orphanCount: 0 }),
    reconcileAndPersist: jest.fn().mockResolvedValue({ windowDays: 14, deliveredShipments: 0, missingIncome: [], orphanIncome: [], missingCount: 0, orphanCount: 0 }),
    history: jest.fn().mockResolvedValue([]),
  } as any;
  const parity = {
    recentRuns: jest.fn().mockResolvedValue([]),
    divergences: jest.fn().mockResolvedValue({ runId: null, rows: [] }),
  } as any;
  const ctrl = new TrackingSyncController(compare, cobrosRecon, parity);

  it('delegates compare/tracking', async () => {
    await ctrl.compareTracking('TN1');
    expect(compare.compareByTracking).toHaveBeenCalledWith('TN1');
  });
  it('delegates compare/route', async () => {
    await ctrl.compareRoute('r1');
    expect(compare.compareByRoute).toHaveBeenCalledWith('r1');
  });
  it('delegates compare/consolidated', async () => {
    await ctrl.compareConsolidated('c1');
    expect(compare.compareByConsolidated).toHaveBeenCalledWith('c1');
  });
  it('apply delegates to compare.applyMany with actor from req.user', async () => {
    const req = { user: { id: 'u1', name: 'Super', role: 'superadmin' } };
    await ctrl.apply({ shipmentIds: ['s1', 's2'] }, req);
    expect(compare.applyMany).toHaveBeenCalledWith(['s1', 's2'], { userId: 'u1', userName: 'Super', role: 'superadmin' });
  });
  it('cobros-reconciliation usa ventana por defecto 14 y respeta el query', async () => {
    await ctrl.cobrosReconciliation(undefined);
    expect(cobrosRecon.reconcile).toHaveBeenCalledWith(14);
    await ctrl.cobrosReconciliation('7');
    expect(cobrosRecon.reconcile).toHaveBeenCalledWith(7);
  });
  it('cobros-reconciliation/history delega con limit', async () => {
    await ctrl.cobrosReconciliationHistory('10');
    expect(cobrosRecon.history).toHaveBeenCalledWith(10);
  });
  it('cobros-reconciliation/run persiste', async () => {
    await ctrl.cobrosReconciliationRun({ windowDays: 30 });
    expect(cobrosRecon.reconcileAndPersist).toHaveBeenCalledWith(30);
  });
  it('parity/runs delega', async () => {
    await ctrl.parityRuns('5');
    expect(parity.recentRuns).toHaveBeenCalledWith(5);
  });
  it('parity/divergences delega runId + limit', async () => {
    await ctrl.parityDivergences('run1', '50');
    expect(parity.divergences).toHaveBeenCalledWith('run1', 50);
  });
});
