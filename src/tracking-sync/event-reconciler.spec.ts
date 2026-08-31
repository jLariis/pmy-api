import { EventReconciler } from './event-reconciler';
import { NormalizedEvent, NormalizedTracking } from './tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function ev(shadowKey: string, status: ShipmentStatusType, ms: number): NormalizedEvent {
  return {
    occurredAt: new Date(ms), derivedCode: null, statusCode: null, exceptionCode: null,
    eventType: null, description: null, location: null, status,
    eventKey: 'ek-' + shadowKey, shadowKey,
  };
}

function tracking(events: NormalizedEvent[]): NormalizedTracking {
  return { trackingNumber: 'TN', events, latest: events[events.length - 1] ?? null, commitDateTime: null, header: { code: null, derivedCode: null, ancillaryReason: null, isDeliveredHeader: false, actualDeliveryAt: null, receivedByName: null, uniqueId: null, carrierCode: null, code44At: null }, validation: { ok: true, issues: [] } };
}

describe('EventReconciler', () => {
  const r = new EventReconciler();
  const keyOf = (e: NormalizedEvent) => e.shadowKey;

  it('returns only events whose key is unknown', () => {
    const t = tracking([ev('a', ShipmentStatusType.RECOLECCION, 1), ev('b', ShipmentStatusType.EN_RUTA, 2)]);
    const out = r.reconcile(t, new Set(['a']), ShipmentStatusType.PENDIENTE, keyOf);
    expect(out.newEvents.map((e) => e.shadowKey)).toEqual(['b']);
  });

  it('is idempotent: all keys known → zero new events', () => {
    const t = tracking([ev('a', ShipmentStatusType.RECOLECCION, 1)]);
    const out = r.reconcile(t, new Set(['a']), ShipmentStatusType.RECOLECCION, keyOf);
    expect(out.newEvents).toHaveLength(0);
    expect(out.transition).toBeNull();
  });

  it('proposedStatus is the latest event status; sets transition when it differs', () => {
    const t = tracking([ev('a', ShipmentStatusType.RECOLECCION, 1), ev('b', ShipmentStatusType.EN_RUTA, 2)]);
    const out = r.reconcile(t, new Set(), ShipmentStatusType.PENDIENTE, keyOf);
    expect(out.proposedStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(out.transition).toEqual({ from: ShipmentStatusType.PENDIENTE, to: ShipmentStatusType.EN_RUTA });
  });
});
