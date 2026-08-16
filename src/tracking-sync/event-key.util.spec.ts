import { buildEventKey, buildShadowKey } from './event-key.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('event-key utils', () => {
  const base = {
    trackingNumber: '123',
    occurredAt: new Date('2026-08-15T10:00:00Z'),
    derivedCode: 'IT',
    eventType: 'IT',
    exceptionCode: '',
    location: 'Hermosillo',
  };

  it('buildEventKey is deterministic (idempotent)', () => {
    expect(buildEventKey(base)).toBe(buildEventKey({ ...base }));
  });

  it('buildEventKey changes when a component changes', () => {
    expect(buildEventKey(base)).not.toBe(buildEventKey({ ...base, exceptionCode: '08' }));
  });

  it('buildEventKey is case-insensitive on codes/location', () => {
    expect(buildEventKey(base)).toBe(buildEventKey({ ...base, derivedCode: 'it', location: 'hermosillo' }));
  });

  it('buildShadowKey matches on (timestamp, exception, status)', () => {
    const ms = base.occurredAt.getTime();
    expect(buildShadowKey(ms, '08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE))
      .toBe(buildShadowKey(ms, '08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE));
  });
});
