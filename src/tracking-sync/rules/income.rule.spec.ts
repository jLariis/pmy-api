import { IncomeRule } from './income.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function ev(over: any) {
  return {
    occurredAt: new Date('2026-08-20T10:00:00Z'), derivedCode: null, statusCode: null,
    exceptionCode: over.ec ?? null, eventType: null, description: null, location: null,
    status: over.status, eventKey: over.k, shadowKey: over.k,
  };
}

describe('IncomeRule', () => {
  it('encola un efecto income por evento cobrable (DL) en envío', async () => {
    const ds: any = { query: jest.fn() };
    const rule = new IncomeRule(ds);
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO });
    (ctx.shipment as any).subsidiary = { id: 'sub1' };
    ctx.reconcile.newEvents = [ev({ k: 'k1', status: ShipmentStatusType.ENTREGADO })] as any;
    await rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(1);
    expect(ctx.deferredEffects[0].type).toBe('income');
    expect(ctx.deferredEffects[0].payload.eventKey).toBe('k1');
    expect(ctx.deferredEffects[0].payload.subsidiaryId).toBe('sub1');
    expect(ds.query).not.toHaveBeenCalled(); // sin 08, no consulta
  });

  it('no encola para cargas (kind=charge)', async () => {
    const ds: any = { query: jest.fn() };
    const rule = new IncomeRule(ds);
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO });
    (ctx as any).kind = 'charge';
    ctx.reconcile.newEvents = [ev({ k: 'k1', status: ShipmentStatusType.ENTREGADO })] as any;
    await rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(0);
  });

  it('cuenta 08 previos de BD para la 3ra visita', async () => {
    const ds: any = { query: jest.fn().mockResolvedValue([{ c: 2 }]) };
    const rule = new IncomeRule(ds);
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.CLIENTE_NO_DISPONIBLE });
    (ctx.shipment as any).subsidiary = { id: 'sub1' };
    ctx.reconcile.newEvents = [ev({ k: 'k8', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE })] as any;
    await rule.apply(ctx);
    expect(ds.query).toHaveBeenCalled();
    expect(ctx.deferredEffects).toHaveLength(1); // 2 previas + 1 = 3ra visita
  });
});
