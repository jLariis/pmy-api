import { DeliveryHeaderRule } from './delivery-header.rule';
import { TimeShieldRule } from './time-shield.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('DeliveryHeaderRule', () => {
  const rule = new DeliveryHeaderRule();
  it('header DL → ENTREGADO aunque el propuesto sea otro', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    ctx.normalized.header.isDeliveredHeader = true;
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });
  it('sin header DL → no toca', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.EN_BODEGA);
  });
});

describe('TimeShieldRule', () => {
  const rule = new TimeShieldRule();
  const t = (iso: string) => new Date(iso);

  it('evento FedEx MÁS VIEJO que la op interna → conserva el actual', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    ctx.existing.lastOpTime = t('2026-08-20T18:00:00Z').getTime();
    ctx.normalized.latest = { occurredAt: t('2026-08-20T10:00:00Z') } as any; // más viejo
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.EN_RUTA); // conservado
  });

  it('evento FedEx MÁS NUEVO → respeta a FedEx', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    ctx.existing.lastOpTime = t('2026-08-20T10:00:00Z').getTime();
    ctx.normalized.latest = { occurredAt: t('2026-08-20T18:00:00Z') } as any; // más nuevo
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.EN_BODEGA);
  });

  it('ENTREGADO siempre gana (aunque sea más viejo)', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO });
    ctx.existing.lastOpTime = t('2026-08-20T18:00:00Z').getTime();
    ctx.normalized.latest = { occurredAt: t('2026-08-20T10:00:00Z') } as any;
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });
});
