import { TerminalLockRule } from './rules/terminal-lock.rule';
import { ExternalDeliveryRule } from './rules/external-delivery.rule';
import { IncomeRule } from './rules/income.rule';
import { NotificationRule } from './rules/notification.rule';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { makeCtx } from './rules/test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('rules registration order + inactive hooks', () => {
  it('assembles all four rules and runs terminal-lock first, income/notification are no-ops', async () => {
    const rules = [new TerminalLockRule(), new ExternalDeliveryRule(), new IncomeRule(), new NotificationRule()];
    const pipeline = new SyncRulesPipeline(rules);
    const ctx = makeCtx({ current: ShipmentStatusType.ENTREGADO, proposed: ShipmentStatusType.EN_RUTA });
    await pipeline.run(ctx);
    // TerminalLock (priority 100) blocked the regression; income/notification did nothing.
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(ctx.deferredEffects).toHaveLength(0);
  });
});
