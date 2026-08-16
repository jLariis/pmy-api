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

  it('always allows ENTREGADO to win', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.DEVUELTO_A_FEDEX, proposed: ShipmentStatusType.ENTREGADO });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('does nothing when current status is not terminal', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.EN_BODEGA);
  });
});
