import { ExternalDeliveryRule } from './external-delivery.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

const OD_EVENT = { eventType: 'OD', derivedCode: 'OD' };

describe('ExternalDeliveryRule', () => {
  const rule = new ExternalDeliveryRule();

  it('sets ACARGO_DE_FEDEX when subsidiary tracks external delivery and there is an OD event', () => {
    const ctx = makeCtx({
      current: ShipmentStatusType.EN_RUTA,
      proposed: ShipmentStatusType.EN_RUTA,
      subsidiary: { trackFedexExternalDelivery: true },
      events: [OD_EVENT],
    });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ACARGO_DE_FEDEX);
  });

  it('sets ENTREGADO_POR_FEDEX when delivered under external delivery', () => {
    const ctx = makeCtx({
      current: ShipmentStatusType.EN_RUTA,
      proposed: ShipmentStatusType.ENTREGADO,
      subsidiary: { trackFedexExternalDelivery: true },
      events: [OD_EVENT],
    });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO_POR_FEDEX);
  });

  it('does nothing when subsidiary does not track external delivery', () => {
    const ctx = makeCtx({
      current: ShipmentStatusType.EN_RUTA,
      proposed: ShipmentStatusType.ENTREGADO,
      subsidiary: { trackFedexExternalDelivery: false },
      events: [OD_EVENT],
    });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });

  describe('entrega en ruta nuestra el mismo día (regla 2026-09-24)', () => {
    // 383519245821 (Cabo): OD viejo de FedEx (04-09), consolidado nuestro, ruta nuestra 14-09, DL 14-09.
    const events = [
      { eventType: 'OD', derivedCode: 'OD', occurredAt: new Date('2026-09-04T17:00:00Z') },
      { eventType: 'DL', derivedCode: 'DL', exceptionCode: '005', occurredAt: new Date('2026-09-15T01:24:00Z') },
    ];

    it('DL el día de nuestra ruta y con consolidado → se queda ENTREGADO (no por FedEx)', () => {
      const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO, subsidiary: { trackFedexExternalDelivery: true }, events });
      (ctx.shipment as any).consolidatedId = 'cons-1';
      ctx.existing.ourRouteDays = ['2026-09-14'];
      rule.apply(ctx);
      expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
    });

    it('sin ruta nuestra ese día → sigue siendo ENTREGADO_POR_FEDEX', () => {
      const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO, subsidiary: { trackFedexExternalDelivery: true }, events });
      (ctx.shipment as any).consolidatedId = 'cons-1';
      ctx.existing.ourRouteDays = ['2026-09-12'];
      rule.apply(ctx);
      expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO_POR_FEDEX);
    });

    it('propuesto ENTREGADO_POR_FEDEX (p. ej. por 005) pero fue nuestra ruta → se corrige a ENTREGADO', () => {
      const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO_POR_FEDEX, subsidiary: { trackFedexExternalDelivery: false }, events });
      (ctx.shipment as any).consolidatedId = 'cons-1';
      ctx.existing.ourRouteDays = ['2026-09-14'];
      rule.apply(ctx);
      expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
    });
  });
});
