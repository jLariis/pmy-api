import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';

describe('tracking-sync entities', () => {
  it('TrackingSyncRun is constructable and assignable', () => {
    const r = new TrackingSyncRun();
    r.mode = 'shadow';
    r.total = 10;
    expect(r.mode).toBe('shadow');
    expect(r.total).toBe(10);
  });

  it('TrackingSyncObservation is constructable and assignable', () => {
    const o = new TrackingSyncObservation();
    o.runId = 'run-1';
    o.shipmentId = 'ship-1';
    o.matchesLegacy = true;
    expect(o.runId).toBe('run-1');
    expect(o.matchesLegacy).toBe(true);
  });
});
