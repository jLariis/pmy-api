import { PreRegistrationRule } from './pre-registration.rule';
import { PreRegResolvedRule } from './pre-reg-resolved.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

// createdAt: 2026-08-20 (hora Hermosillo). Eventos del mismo día en UTC ~13:00Z (06:00 local).
const CREATED = new Date('2026-08-20T20:00:00Z'); // ~13:00 Hermosillo
const ev = (k: string, isoUtc: string, status = ShipmentStatusType.EN_BODEGA) => ({
  occurredAt: new Date(isoUtc), status, eventKey: k, shadowKey: k,
  derivedCode: null, statusCode: null, exceptionCode: null, eventType: null, description: null, location: null,
} as any);

function ctxWith(sub: any, events: any[]) {
  const ctx = makeCtx({ current: ShipmentStatusType.PENDIENTE, proposed: ShipmentStatusType.PENDIENTE, subsidiary: sub });
  (ctx.shipment as any).createdAt = CREATED;
  ctx.reconcile.newEvents = events;
  return ctx;
}

describe('PreRegistrationRule (veto)', () => {
  const rule = new PreRegistrationRule();

  it('sucursal normal: veta evento anterior a createdAt', () => {
    const ctx = ctxWith({ allowSameDayPreRegistrationFedexEvents: false }, [
      ev('viejo', '2026-08-20T15:00:00Z'), // antes de createdAt
      ev('nuevo', '2026-08-20T22:00:00Z'), // después
    ]);
    rule.apply(ctx);
    expect(ctx.vetoedEventKeys.has('viejo')).toBe(true);
    expect(ctx.vetoedEventKeys.has('nuevo')).toBe(false);
  });

  it('bodega-FedEx: NO veta el evento del mismo día previo a createdAt', () => {
    const ctx = ctxWith({ allowSameDayPreRegistrationFedexEvents: true }, [
      ev('mismoDia', '2026-08-20T15:00:00Z'), // mismo día calendario, antes de createdAt
    ]);
    rule.apply(ctx);
    expect(ctx.vetoedEventKeys.has('mismoDia')).toBe(false);
  });

  it('bodega-FedEx: SÍ veta un evento de OTRO día previo', () => {
    const ctx = ctxWith({ allowSameDayPreRegistrationFedexEvents: true }, [
      ev('otroDia', '2026-08-18T15:00:00Z'),
    ]);
    rule.apply(ctx);
    expect(ctx.vetoedEventKeys.has('otroDia')).toBe(true);
  });
});

describe('PreRegResolvedRule', () => {
  const rule = new PreRegResolvedRule();

  it('bodega-FedEx: refleja DEX resuelto del mismo día como estatus', () => {
    const ctx = ctxWith({ allowSameDayPreRegistrationFedexEvents: true }, [
      ev('dex', '2026-08-20T15:00:00Z', ShipmentStatusType.RECHAZADO),
    ]);
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.RECHAZADO);
  });

  it('sucursal normal: no aplica', () => {
    const ctx = ctxWith({ allowSameDayPreRegistrationFedexEvents: false }, [
      ev('dex', '2026-08-20T15:00:00Z', ShipmentStatusType.RECHAZADO),
    ]);
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.PENDIENTE);
  });
});
