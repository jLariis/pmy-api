import { TrackingNormalizer } from './tracking-normalizer';
import { RawTrackingResult } from './tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function raw(): RawTrackingResult {
  return {
    trackingNumber: 'TN1',
    trackResults: [
      {
        latestStatusDetail: { derivedCode: 'DL', code: 'DL' },
        dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-08-14T20:00:00Z' }],
        scanEvents: [
          // Deliberadamente DESORDENADOS para probar el orden cronológico.
          { date: '2026-08-14T20:00:00Z', eventType: 'DL', derivedStatusCode: 'DL', eventDescription: 'Delivered', scanLocation: { city: 'Hermosillo' } },
          { date: '2026-08-12T09:00:00Z', eventType: 'PU', derivedStatusCode: 'PU', eventDescription: 'Picked up', scanLocation: { city: 'Nogales' } },
          { date: '2026-08-13T09:00:00Z', eventType: 'IT', derivedStatusCode: 'IT', eventDescription: 'In transit', scanLocation: { city: 'Nogales' } },
        ],
      },
    ],
  };
}

describe('TrackingNormalizer', () => {
  const n = new TrackingNormalizer();

  it('orders events chronologically ascending', () => {
    const out = n.normalize(raw());
    const times = out.events.map((e) => e.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(out.events).toHaveLength(3);
  });

  it('latest is the most recent event and maps to ENTREGADO', () => {
    const out = n.normalize(raw());
    expect(out.latest?.eventType).toBe('DL');
    expect(out.latest?.status).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('assigns eventKey and shadowKey to every event', () => {
    const out = n.normalize(raw());
    for (const e of out.events) {
      expect(e.eventKey).toMatch(/^[a-f0-9]{40}$/);
      expect(e.shadowKey).toContain('|');
    }
  });

  it('flags validation issues when there are no scanEvents', () => {
    const out = n.normalize({ trackingNumber: 'TN2', trackResults: [{ latestStatusDetail: null, scanEvents: [] }] });
    expect(out.validation.ok).toBe(false);
    expect(out.latest).toBeNull();
  });

  it('entrega FANTASMA (DL seguido de salida/llegada) queda como tránsito y el header no cuenta como entregado', () => {
    const out = n.normalize({
      trackingNumber: 'TN2',
      trackResults: [{
        latestStatusDetail: { derivedCode: 'IT', code: 'AR' },
        scanEvents: [
          { date: '2026-09-30T18:07:00Z', eventType: 'PU', derivedStatusCode: 'PU' },
          { date: '2026-09-30T23:56:00Z', eventType: 'DL', derivedStatusCode: 'DL' },
          { date: '2026-10-01T05:40:00Z', eventType: 'DP', derivedStatusCode: 'IT' },
        ],
      }],
    } as any);
    const dl = out.events.find((e) => e.eventType === 'DL')!;
    expect(dl.status).toBe(ShipmentStatusType.EN_TRANSITO);
    expect(out.events.some((e) => e.status === ShipmentStatusType.ENTREGADO)).toBe(false);
    expect(out.header.isDeliveredHeader).toBe(false);
  });
});

