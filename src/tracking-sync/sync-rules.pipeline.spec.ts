import { SyncRulesPipeline } from './sync-rules.pipeline';
import { SyncContext, SyncRule } from './tracking-sync.types';
import { makeCtx } from './rules/test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function recordingRule(name: string, priority: number, order: string[]): SyncRule {
  return { name, priority, apply: (_c) => { order.push(name); } };
}

describe('SyncRulesPipeline', () => {
  it('runs rules in descending priority order', async () => {
    const order: string[] = [];
    const pipeline = new SyncRulesPipeline([
      recordingRule('low', 5, order),
      recordingRule('high', 100, order),
      recordingRule('mid', 50, order),
    ]);
    await pipeline.run(makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA }));
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('lets an earlier rule affect a later one via shared context', async () => {
    const setDelivered: SyncRule = { name: 'a', priority: 100, apply: (c) => { c.proposedStatus = ShipmentStatusType.ENTREGADO; } };
    const readIt: SyncRule = { name: 'b', priority: 50, apply: (c) => { if (c.proposedStatus === ShipmentStatusType.ENTREGADO) c.notes.push('seen'); } };
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA });
    await new SyncRulesPipeline([readIt, setDelivered]).run(ctx);
    expect(ctx.notes).toContain('seen');
  });
});
