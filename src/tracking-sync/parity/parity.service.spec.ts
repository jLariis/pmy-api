import { ParityService } from './parity.service';

function ds(runs: any[], divergences: any[], latestId = 'run1') {
  const runRepo = {
    find: jest.fn().mockResolvedValue(runs),
    findOne: jest.fn().mockResolvedValue(latestId ? { id: latestId } : null),
  };
  return {
    getRepository: () => runRepo,
    query: jest.fn().mockResolvedValue(divergences),
    _runRepo: runRepo,
  } as any;
}

describe('ParityService', () => {
  it('recentRuns calcula % de coincidencia', async () => {
    const d = ds([{ id: 'r1', startedAt: new Date(), finishedAt: new Date(), total: 100, ok: 90, matchesLegacy: 80, divergesLegacy: 20, aborted: false }], []);
    const rows = await new ParityService(d).recentRuns(10);
    expect(rows[0].matchPct).toBe(80); // 80 / (80+20)
    expect(rows[0].divergesLegacy).toBe(20);
  });

  it('recentRuns con 0 comparaciones → 100%', async () => {
    const d = ds([{ id: 'r1', startedAt: new Date(), total: 0, ok: 0, matchesLegacy: 0, divergesLegacy: 0 }], []);
    const rows = await new ParityService(d).recentRuns();
    expect(rows[0].matchPct).toBe(100);
  });

  it('divergences usa la corrida más reciente si no se pasa runId y enriquece', async () => {
    const d = ds([], [
      { trackingNumber: 'A', kind: 'shipment', legacyCurrentStatus: 'en_ruta', proposedStatus: 'entregado', wouldInsertEvents: 2, consNumber: 'C1', subsidiary: 'HMO', recipientName: 'Juan' },
    ], 'runX');
    const out = await new ParityService(d).divergences();
    expect(out.runId).toBe('runX');
    expect(out.rows[0]).toMatchObject({ trackingNumber: 'A', consNumber: 'C1', subsidiary: 'HMO', legacyCurrentStatus: 'en_ruta', proposedStatus: 'entregado' });
    expect(d.query).toHaveBeenCalled();
  });

  it('sin corridas shadow → vacío', async () => {
    const d = ds([], [], '');
    const out = await new ParityService(d).divergences();
    expect(out.runId).toBeNull();
    expect(out.rows).toHaveLength(0);
  });
});
