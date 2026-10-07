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

function ctxWith(newEvents: any[], proposed: ShipmentStatusType, current: ShipmentStatusType, kind: 'shipment' | 'charge' = 'shipment'): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN1', status: current } as any,
    kind,
    normalized: { trackingNumber: 'TN1', events: [], latest: null, commitDateTime: null, header: { code: null, derivedCode: null, ancillaryReason: null, isDeliveredHeader: false, actualDeliveryAt: null, receivedByName: null, uniqueId: null, carrierCode: null, code44At: null }, validation: { ok: true, issues: [] } },
    reconcile: { newEvents, proposedStatus: proposed, currentStatus: current, transition: null },
    proposedStatus: proposed,
    existing: { lastOpTime: 0, count08: 0 },
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
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit, { execute: jest.fn() } as any);

    const ctx = ctxWith([ev(1000, ShipmentStatusType.EN_RUTA, null), ev(2000, ShipmentStatusType.ENTREGADO, null)], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA);
    const out = await sink.applyPlan(ctx, { userId: 'u1', role: 'superadmin' });

    expect(out.applied).toBe(true);
    expect(out.insertedEvents).toBe(2);
    expect(out.toStatus).toBe(ShipmentStatusType.ENTREGADO);
    // one Shipment save (status) + 2 ShipmentStatus saves
    expect(manager.save).toHaveBeenCalledTimes(3);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it.each([ShipmentStatusType.ENTREGADO, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.RETORNO_ABANDONO_FEDEX])(
    'estatus final (%s): no escribe historial, estatus ni ingresos',
    async (current) => {
      const manager = fakeManager([]);
      const audit = { log: jest.fn() } as any;
      const income = { execute: jest.fn() } as any;
      const ds = fakeDataSource(manager);
      const sink = new PersistentSyncSink(ds, audit, income);
      const ctx = ctxWith([ev(3000, ShipmentStatusType.ENTREGADO, null)], ShipmentStatusType.ENTREGADO, current);
      const out = await sink.applyPlan(ctx, { userId: 'u1', role: 'system' });
      expect(out.applied).toBe(false);
      expect(out.skippedReason).toMatch(/final/i);
      expect(ds.transaction).not.toHaveBeenCalled();
      expect(income.execute).not.toHaveBeenCalled();
    },
  );

  // Bug 2026-10-07 (cargas F2 31.5 / Loreto): el pre-registro vetaba el evento de entrega
  // (anterior a la subida) pero el estatus SÍ pasaba a ENTREGADO → estatus sin historial.
  it('guarda SIEMPRE el evento que respalda el nuevo estatus aunque esté vetado por pre-registro', async () => {
    const manager = fakeManager([]);
    const sink = new PersistentSyncSink(fakeDataSource(manager), { log: jest.fn() } as any, { execute: jest.fn() } as any);
    const transit = ev(1000, ShipmentStatusType.EN_TRANSITO, null);
    const dl = ev(2000, ShipmentStatusType.ENTREGADO, null);
    const ctx = ctxWith([transit, dl], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA, 'charge');
    ctx.normalized.events = [transit, dl] as any;
    ctx.vetoedEventKeys = new Set([transit.eventKey, dl.eventKey]);

    const out = await sink.applyPlan(ctx, { userId: 'u1', role: 'system' });

    const rows = manager.saved.filter((x: any) => x.timestamp);
    expect(rows.map((r: any) => r.status)).toEqual([ShipmentStatusType.ENTREGADO]); // el tránsito vetado sigue fuera
    expect(out.insertedEvents).toBe(1);
    expect(out.toStatus).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('el evento respaldo vetado se guarda con el estatus FINAL (entrega por FedEx → entregado en ruta nuestra)', async () => {
    const manager = fakeManager([]);
    const sink = new PersistentSyncSink(fakeDataSource(manager), { log: jest.fn() } as any, { execute: jest.fn() } as any);
    const dl = ev(2000, ShipmentStatusType.ENTREGADO_POR_FEDEX, null);
    const ctx = ctxWith([dl], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA);
    ctx.normalized.events = [dl] as any;
    ctx.vetoedEventKeys = new Set([dl.eventKey]);

    await sink.applyPlan(ctx, { userId: 'u1', role: 'system' });

    const rows = manager.saved.filter((x: any) => x.timestamp);
    expect(rows.map((r: any) => r.status)).toEqual([ShipmentStatusType.ENTREGADO]);
  });

  it('no duplica: si el historial ya tiene una fila con el estatus nuevo, no agrega el respaldo vetado', async () => {
    const manager = fakeManager([{ timestamp: new Date(1500), exceptionCode: null, status: ShipmentStatusType.ENTREGADO }]);
    const sink = new PersistentSyncSink(fakeDataSource(manager), { log: jest.fn() } as any, { execute: jest.fn() } as any);
    const dl = ev(2000, ShipmentStatusType.ENTREGADO, null);
    const ctx = ctxWith([dl], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA);
    ctx.normalized.events = [dl] as any;
    ctx.vetoedEventKeys = new Set([dl.eventKey]);

    await sink.applyPlan(ctx, { userId: 'u1', role: 'system' });

    expect(manager.saved.filter((x: any) => x.timestamp)).toHaveLength(0);
  });

  it('is idempotent: events already present (by shadowKey) are not re-inserted', async () => {
    const existing = [{ timestamp: new Date(1000), exceptionCode: null, status: ShipmentStatusType.EN_RUTA }];
    const manager = fakeManager(existing);
    const audit = { log: jest.fn() } as any;
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit, { execute: jest.fn() } as any);

    const ctx = ctxWith([ev(1000, ShipmentStatusType.EN_RUTA, null)], ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA);
    const out = await sink.applyPlan(ctx, { role: 'superadmin' });

    expect(out.insertedEvents).toBe(0);
    expect(out.applied).toBe(false); // nothing changed (same status, no new events)
  });

  it('for F2 (kind=charge) writes ShipmentStatus with chargeShipment and reads charge history', async () => {
    const manager = fakeManager([]);
    const audit = { log: jest.fn() } as any;
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit, { execute: jest.fn() } as any);

    const ctx = ctxWith([ev(3000, ShipmentStatusType.ENTREGADO, null)], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA, 'charge');
    const out = await sink.applyPlan(ctx, { role: 'superadmin' });

    expect(out.applied).toBe(true);
    expect(out.insertedEvents).toBe(1);
    // La lectura de historial se hizo por chargeShipment (no shipment).
    expect(manager.find.mock.calls[0][1].where).toEqual({ chargeShipment: { id: 's1' } });
    // El ShipmentStatus creado lleva chargeShipment, no shipment.
    const createdStatus = manager.create.mock.calls.find((c: any) => c[1]?.timestamp)?.[1];
    expect(createdStatus.chargeShipment).toBeDefined();
    expect(createdStatus.shipment).toBeUndefined();
  });
});
