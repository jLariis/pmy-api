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
});
