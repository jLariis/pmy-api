import { TerminalLockRule } from './terminal-lock.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('TerminalLockRule', () => {
  const rule = new TerminalLockRule();

  it('blocks regression from a terminal status to an operative one', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.ENTREGADO, proposed: ShipmentStatusType.EN_RUTA });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(ctx.notes.join(' ')).toContain('Escudo Terminal');
  });

  it('DEVUELTO_A_FEDEX es final: una entrega de FedEx NO lo revive', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.DEVUELTO_A_FEDEX, proposed: ShipmentStatusType.ENTREGADO });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.DEVUELTO_A_FEDEX);
  });

  it('ENTREGADO es final: no pasa a ningún otro estatus (ni terminal)', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.ENTREGADO, proposed: ShipmentStatusType.DEVUELTO_A_FEDEX });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('otros terminales (entregado por FedEx) sí pueden pasar a ENTREGADO', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.ENTREGADO_POR_FEDEX, proposed: ShipmentStatusType.ENTREGADO });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('does nothing when current status is not terminal', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.EN_BODEGA);
  });

  it('RETORNO_ABANDONO_FEDEX es final: una entrega de FedEx no lo revive', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.RETORNO_ABANDONO_FEDEX, proposed: ShipmentStatusType.ENTREGADO });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.RETORNO_ABANDONO_FEDEX);
  });
});
