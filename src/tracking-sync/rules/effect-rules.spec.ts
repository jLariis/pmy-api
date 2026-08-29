import { Code44Rule } from './code44.rule';
import { MetadataPersistRule } from './metadata-persist.rule';
import { IncomeHeaderSafetyNetRule } from './income-header-safety-net.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

describe('Code44Rule', () => {
  const rule = new Code44Rule();
  it('emite efecto code44 si la sucursal monitorea 44 y hay code44At', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.PENDIENTE, proposed: ShipmentStatusType.PENDIENTE, subsidiary: { monitorFedexCode44: true } });
    ctx.normalized.header.code44At = new Date('2026-08-20T10:00:00Z');
    rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(1);
    expect(ctx.deferredEffects[0].type).toBe('code44');
  });
  it('no emite si la sucursal no monitorea 44', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.PENDIENTE, proposed: ShipmentStatusType.PENDIENTE, subsidiary: { monitorFedexCode44: false } });
    ctx.normalized.header.code44At = new Date();
    rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(0);
  });
});

describe('MetadataPersistRule', () => {
  const rule = new MetadataPersistRule();
  it('emite uniqueId/carrier/receivedBy', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA });
    ctx.normalized.header.uniqueId = 'U1';
    ctx.normalized.header.carrierCode = 'FXG';
    ctx.normalized.header.receivedByName = 'Juan';
    rule.apply(ctx);
    expect(ctx.deferredEffects[0].payload).toMatchObject({ uniqueId: 'U1', carrierCode: 'FXG', receivedByName: 'Juan' });
  });
  it('sincroniza commitDateTime si hubo cambio de fecha', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA });
    ctx.normalized.commitDateTime = new Date('2026-08-25T18:00:00Z');
    ctx.reconcile.newEvents = [{ eventKey: 'k', status: ShipmentStatusType.CAMBIO_FECHA_SOLICITADO } as any];
    rule.apply(ctx);
    expect(ctx.deferredEffects[0].payload.commitDateTime).toBe('2026-08-25T18:00:00.000Z');
  });
  it('sin nada que persistir → no emite', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA });
    rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(0);
  });
});

describe('IncomeHeaderSafetyNetRule', () => {
  const rule = new IncomeHeaderSafetyNetRule();
  it('header DL sin evento de entrega → efecto income anclado al header', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO, subsidiary: { id: 'sub1' } });
    ctx.normalized.header.isDeliveredHeader = true;
    ctx.normalized.header.actualDeliveryAt = new Date('2026-08-20T22:00:00Z');
    rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(1);
    expect(ctx.deferredEffects[0].payload.incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(ctx.deferredEffects[0].payload.eventKey).toContain('HDR-DL:');
  });
  it('si hay evento de entrega → no duplica (IncomeRule lo cubre)', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.ENTREGADO });
    ctx.normalized.header.isDeliveredHeader = true;
    ctx.reconcile.newEvents = [{ eventKey: 'k', status: ShipmentStatusType.ENTREGADO } as any];
    rule.apply(ctx);
    expect(ctx.deferredEffects).toHaveLength(0);
  });
});
