import { ShadowSyncSink } from './shadow-sync.sink';
import { SyncContext } from '../tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function ctx(proposed: ShipmentStatusType, current: ShipmentStatusType, newEventKeys: string[]): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN', status: current } as any,
    kind: 'shipment',
    normalized: { trackingNumber: 'TN', events: [], latest: null, commitDateTime: null, validation: { ok: true, issues: ['x'] } },
    reconcile: {
      newEvents: newEventKeys.map((k) => ({ eventKey: k } as any)),
      proposedStatus: proposed, currentStatus: current, transition: null,
    },
    proposedStatus: proposed,
    vetoedEventKeys: new Set<string>(),
    deferredEffects: [],
    notes: [],
  };
}

describe('ShadowSyncSink', () => {
  it('records what it WOULD do and computes matchesLegacy + wouldInsert count', async () => {
    const repo = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = new ShadowSyncSink(repo);

    const out = await sink.applyPlan(ctx(ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA, ['k1', 'k2']), 'run-1');

    expect(out.wouldInsertEvents).toBe(2);
    expect(out.matchesLegacy).toBe(true); // proposed === current
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    const [row, conflict] = repo.upsert.mock.calls[0];
    expect(row).toMatchObject({ runId: 'run-1', shipmentId: 's1', trackingNumber: 'TN', wouldInsertEvents: 2, matchesLegacy: true });
    expect(conflict).toEqual(['runId', 'shipmentId']); // idempotent
  });

  it('excludes vetoed events from the wouldInsert count', async () => {
    const repo = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = new ShadowSyncSink(repo);
    const c = ctx(ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA, ['k1', 'k2']);
    c.vetoedEventKeys.add('k1');
    const out = await sink.applyPlan(c, 'run-1');
    expect(out.wouldInsertEvents).toBe(1);
    expect(out.matchesLegacy).toBe(false);
  });
});
