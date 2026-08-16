import { PersistentSyncSink } from './persistent-sync.sink';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { buildShadowKey } from '../event-key.util';
import { SyncContext } from '../tracking-sync.types';

function fakeManager(existingRows: any[]) {
  const saved: any[] = [];
  return {
    saved,
    find: jest.fn().mockResolvedValue(existingRows),
    create: jest.fn().mockImplementation((_e: any, x: any) => x),
    save: jest.fn().mockImplementation(async (_e: any, x: any) => { saved.push(x); return x; }),
  };
}

function fakeDataSource(manager: any) {
  return {
    transaction: jest.fn().mockImplementation(async (cb: any) => cb(manager)),
  } as any;
}

function ctxWith(newEvents: any[], proposed: ShipmentStatusType, current: ShipmentStatusType): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN1', status: current } as any,
    normalized: { trackingNumber: 'TN1', events: [], latest: null, commitDateTime: null, validation: { ok: true, issues: [] } },
    reconcile: { newEvents, proposedStatus: proposed, currentStatus: current, transition: null },
    proposedStatus: proposed,
    vetoedEventKeys: new Set<string>(),
    deferredEffects: [], notes: [],
  };
}

describe('PersistentSyncSink.applyPlan', () => {
  const ev = (ms: number, status: ShipmentStatusType, ex: string | null) => ({
    occurredAt: new Date(ms), status, exceptionCode: ex, derivedCode: null, eventType: null, description: 'e', location: null,
    eventKey: 'k' + ms, shadowKey: buildShadowKey(ms, ex, status),
  });

  it('inserts missing events, updates status, logs audit', async () => {
    const manager = fakeManager([]); // no existing history
    const audit = { log: jest.fn() } as any;
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit);

    const ctx = ctxWith([ev(1000, ShipmentStatusType.EN_RUTA, null), ev(2000, ShipmentStatusType.ENTREGADO, null)], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA);
    const out = await sink.applyPlan(ctx, { userId: 'u1', role: 'superadmin' });

    expect(out.applied).toBe(true);
    expect(out.insertedEvents).toBe(2);
    expect(out.toStatus).toBe(ShipmentStatusType.ENTREGADO);
    // one Shipment save (status) + 2 ShipmentStatus saves
    expect(manager.save).toHaveBeenCalledTimes(3);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: events already present (by shadowKey) are not re-inserted', async () => {
    const existing = [{ timestamp: new Date(1000), exceptionCode: null, status: ShipmentStatusType.EN_RUTA }];
    const manager = fakeManager(existing);
    const audit = { log: jest.fn() } as any;
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit);

    const ctx = ctxWith([ev(1000, ShipmentStatusType.EN_RUTA, null)], ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA);
    const out = await sink.applyPlan(ctx, { role: 'superadmin' });

    expect(out.insertedEvents).toBe(0);
    expect(out.applied).toBe(false); // nothing changed (same status, no new events)
  });
});
