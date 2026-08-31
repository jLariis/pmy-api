import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function deps() {
  const savedRun: any = { id: 'run-1' };
  return {
    runRepo: {
      create: jest.fn().mockImplementation((x) => ({ ...x })),
      save: jest.fn().mockImplementation(async (x) => ({ ...x, id: x.id ?? 'run-1' })),
    },
    source: { fetch: jest.fn() },
    normalizer: { normalize: jest.fn() },
    reconciler: { reconcile: jest.fn() },
    pipeline: { run: jest.fn().mockResolvedValue(undefined) },
    sink: { applyPlan: jest.fn().mockResolvedValue({ shipmentId: 's1', trackingNumber: 'TN1', proposedStatus: ShipmentStatusType.EN_RUTA, wouldInsertEvents: 1, matchesLegacy: true }) },
    loader: {
      load: jest.fn().mockResolvedValue(new Set<string>()),
      loadFull: jest.fn().mockResolvedValue({ keys: new Set<string>(), existing: { lastOpTime: 0, count08: 0 } }),
    },
    incomeReconciler: { reconcile: jest.fn().mockResolvedValue({ rows: [], missingCount: 0, okCount: 0 }) },
    savedRun,
  };
}

describe('TrackingSyncOrchestrator', () => {
  it('counts ok vs noData and finalizes the run', async () => {
    const d = deps();
    d.source.fetch.mockResolvedValue([
      { trackingNumber: 'TN1', trackResults: [{}] },
      { trackingNumber: 'TN2', trackResults: [] }, // sin datos
    ]);
    d.normalizer.normalize.mockImplementation((raw: any) => ({
      trackingNumber: raw.trackingNumber, events: raw.trackResults.length ? [{}] : [],
      latest: raw.trackResults.length ? { status: ShipmentStatusType.EN_RUTA } : null,
      commitDateTime: null, validation: { ok: true, issues: [] },
    }));
    d.reconciler.reconcile.mockReturnValue({ newEvents: [{ eventKey: 'k1' }], proposedStatus: ShipmentStatusType.EN_RUTA, currentStatus: ShipmentStatusType.EN_RUTA, transition: null });

    const orch = new TrackingSyncOrchestrator(d.runRepo as any, d.source as any, d.normalizer as any, d.reconciler as any, d.pipeline as any, d.sink as any, d.loader as any, d.incomeReconciler as any);
    const items = [
      { kind: 'shipment' as const, entity: { id: 's1', trackingNumber: 'TN1', status: ShipmentStatusType.EN_RUTA } as any },
      { kind: 'shipment' as const, entity: { id: 's2', trackingNumber: 'TN2', status: ShipmentStatusType.PENDIENTE } as any },
    ];
    const res = await orch.runShadow(items);

    expect(res.ok).toBe(1);
    expect(res.noData).toBe(1);
    expect(res.aborted).toBe(false);
    expect(d.sink.applyPlan).toHaveBeenCalledTimes(1);
    expect(d.runRepo.save).toHaveBeenCalled(); // run persisted (start + finalize)
  });

  it('aborts (circuit breaker) when the source throws a connectivity error and nothing succeeds', async () => {
    const d = deps();
    d.source.fetch.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    const orch = new TrackingSyncOrchestrator(d.runRepo as any, d.source as any, d.normalizer as any, d.reconciler as any, d.pipeline as any, d.sink as any, d.loader as any, d.incomeReconciler as any);
    const res = await orch.runShadow([{ kind: 'shipment', entity: { id: 's1', trackingNumber: 'TN1', status: ShipmentStatusType.EN_RUTA } as any }]);
    expect(res.aborted).toBe(true);
    expect(res.ok).toBe(0);
  });
});
