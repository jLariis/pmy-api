import { TrackingCompareService } from './tracking-compare.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { buildShadowKey } from './event-key.util';

function makeService(over: {
  shipment: any;
  historyRows: any[];
  normalized: any;
}) {
  const shipmentRepo = {
    findOne: jest.fn().mockResolvedValue(over.shipment),
    createQueryBuilder: jest.fn(),
  } as any;
  const statusRepo = { find: jest.fn().mockResolvedValue(over.historyRows) } as any;
  const source = { fetch: jest.fn().mockResolvedValue([{ trackingNumber: over.shipment?.trackingNumber ?? 'X', trackResults: [{}] }]) } as any;
  const normalizer = { normalize: jest.fn().mockReturnValue(over.normalized) } as any;
  const reconciler = {
    reconcile: (normalized: any, known: Set<string>, current: any, keyOf: any) => ({
      newEvents: normalized.events.filter((e: any) => !known.has(keyOf(e))),
      proposedStatus: normalized.latest ? normalized.latest.status : null,
      currentStatus: current,
      transition: null,
    }),
  } as any;
  const pipeline = { run: jest.fn().mockImplementation(async (_ctx: any) => { /* no-op */ }) } as any;
  const sink = { applyPlan: jest.fn() } as any;
  const historyRepo = { find: jest.fn().mockResolvedValue([]) } as any;
  return new TrackingCompareService(shipmentRepo, statusRepo, historyRepo, source, normalizer, reconciler, pipeline, sink);
}

describe('TrackingCompareService.compareByTracking', () => {
  it('flags divergence, staleness and missing events', async () => {
    const ourTs = new Date('2026-08-12T09:00:00Z');
    const fedexTs = new Date('2026-08-14T20:00:00Z');
    const known = { occurredAt: ourTs, status: ShipmentStatusType.EN_RUTA, exceptionCode: null, derivedCode: 'IT', eventType: 'IT', description: 'x', location: 'Hmo', eventKey: 'k-old', shadowKey: buildShadowKey(ourTs.getTime(), null, ShipmentStatusType.EN_RUTA) };
    const fresh = { occurredAt: fedexTs, status: ShipmentStatusType.ENTREGADO, exceptionCode: null, derivedCode: 'DL', eventType: 'DL', description: 'Delivered', location: 'Hmo', eventKey: 'k-new', shadowKey: buildShadowKey(fedexTs.getTime(), null, ShipmentStatusType.ENTREGADO) };

    const svc = makeService({
      shipment: { id: 's1', trackingNumber: 'TN1', status: ShipmentStatusType.EN_RUTA },
      historyRows: [{ timestamp: ourTs, exceptionCode: null, status: ShipmentStatusType.EN_RUTA }],
      normalized: { trackingNumber: 'TN1', events: [known, fresh], latest: fresh, commitDateTime: null, validation: { ok: true, issues: [] } },
    });

    const r = await svc.compareByTracking('TN1');
    expect(r.ourStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(r.fedexStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(r.diverges).toBe(true);
    expect(r.isStale).toBe(true);
    expect(r.missingEvents).toHaveLength(1);
    expect(r.missingEvents[0].status).toBe(ShipmentStatusType.ENTREGADO);
    expect(r.ourLastEventAt).toBe(ourTs.toISOString());
    expect(r.fedexLastEventAt).toBe(fedexTs.toISOString());
  });

  it('returns error when the shipment is not found', async () => {
    const svc = makeService({ shipment: null, historyRows: [], normalized: { events: [], latest: null, validation: { ok: false, issues: [] } } } as any);
    const r = await svc.compareByTracking('NOPE');
    expect(r.error).toBeDefined();
    expect(r.fedexStatus).toBeNull();
  });
});

describe('TrackingCompareService batch loaders', () => {
  function svcWithShipments(shipments: any[], historyRows?: any[]) {
    const shipmentRepo = {
      find: jest.fn().mockResolvedValue(shipments),
      findOne: jest.fn(),
    } as any;
    const statusRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const historyRepo = { find: jest.fn().mockResolvedValue(historyRows ?? []) } as any;
    const source = { fetch: jest.fn().mockResolvedValue(shipments.map((s) => ({ trackingNumber: s.trackingNumber, trackResults: [] }))) } as any;
    const normalizer = { normalize: jest.fn().mockReturnValue({ events: [], latest: null, validation: { ok: false, issues: [] } }) } as any;
    const reconciler = { reconcile: jest.fn().mockReturnValue({ newEvents: [], proposedStatus: null, currentStatus: null, transition: null }) } as any;
    const pipeline = { run: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = { applyPlan: jest.fn() } as any;
    return { svc: new TrackingCompareService(shipmentRepo, statusRepo, historyRepo, source, normalizer, reconciler, pipeline, sink), shipmentRepo, historyRepo };
  }

  it('compareByRoute loads shipments from package_dispatch_history (not the live FK) and dedupes', async () => {
    const s1 = { id: 's1', trackingNumber: 'TN1', status: 'en_ruta' };
    const s2 = { id: 's2', trackingNumber: 'TN2', status: 'en_ruta' };
    // Historia: s1 dos veces (dedupe), s2 una vez, y una fila F2 (chargeShipment) que se ignora.
    const historyRows = [
      { shipment: s1, chargeShipment: null },
      { shipment: s1, chargeShipment: null },
      { shipment: s2, chargeShipment: null },
      { shipment: null, chargeShipment: { id: 'c9' } },
    ];
    const { svc, historyRepo } = svcWithShipments([], historyRows);
    const results = await svc.compareByRoute('route-1');
    expect(results).toHaveLength(2); // s1 y s2, sin duplicar, sin la F2
    expect(historyRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { dispatch: { id: 'route-1' } } }));
  });

  it('compareByConsolidated loads shipments by consolidatedId', async () => {
    const { svc, shipmentRepo } = svcWithShipments([{ id: 's3', trackingNumber: 'TN3', status: 'pendiente' }]);
    const results = await svc.compareByConsolidated('cons-1');
    expect(results).toHaveLength(1);
    expect(shipmentRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { consolidatedId: 'cons-1' } }));
  });
});

describe('TrackingCompareService.applyMany', () => {
  it('builds a context per shipment and delegates to the persistent sink', async () => {
    const shipment = { id: 's1', trackingNumber: 'TN1', status: 'en_ruta' };
    const shipmentRepo = { findOne: jest.fn().mockResolvedValue(shipment), find: jest.fn() } as any;
    const statusRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const source = { fetch: jest.fn().mockResolvedValue([{ trackingNumber: 'TN1', trackResults: [{}] }]) } as any;
    const normalizer = { normalize: jest.fn().mockReturnValue({ events: [], latest: { status: 'entregado' }, validation: { ok: true, issues: [] } }) } as any;
    const reconciler = { reconcile: jest.fn().mockReturnValue({ newEvents: [], proposedStatus: 'entregado', currentStatus: 'en_ruta', transition: null }) } as any;
    const pipeline = { run: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = { applyPlan: jest.fn().mockResolvedValue({ shipmentId: 's1', trackingNumber: 'TN1', applied: true, fromStatus: 'en_ruta', toStatus: 'entregado', insertedEvents: 0 }) } as any;
    const historyRepo = { find: jest.fn().mockResolvedValue([]) } as any;

    const svc = new TrackingCompareService(shipmentRepo, statusRepo, historyRepo, source, normalizer, reconciler, pipeline, sink);
    const out = await svc.applyMany(['s1'], { role: 'superadmin' });
    expect(out).toHaveLength(1);
    expect(sink.applyPlan).toHaveBeenCalledTimes(1);
    expect(out[0].applied).toBe(true);
  });
});
