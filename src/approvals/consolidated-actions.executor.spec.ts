import { ConsolidatedChangeLog } from 'src/entities/consolidated-change-log.entity';
import { IncomeChangeLog } from 'src/entities/income-change-log.entity';
import { ConsolidatedActionsExecutor } from './consolidated-actions.executor';
import { ActionPlan } from './consolidated-actions.types';

const summary = {
  consolidated: 0, shipments: 0, chargeShipments: 0, charges: 0, devolutions: 0,
  incomesAnnulled: 0, incomesMoved: 0, incomesRecosted: 0, incomesRedated: 0, amountBefore: 0, amountAfter: 0,
};
const ctx = { requestId: 'R1', action: 'delete_consolidado', consNumber: '305', userId: 'U1', userName: 'Ana', reason: 'Duplicado de Vía Larga' };

function makeManager() {
  const queries: { sql: string; params: any[] }[] = [];
  const inserts: { entity: any; rows: any[] }[] = [];
  return {
    queries,
    inserts,
    manager: {
      query: jest.fn(async (sql: string, params: any[]) => { queries.push({ sql, params }); }),
      insert: jest.fn(async (entity: any, rows: any[]) => { inserts.push({ entity, rows }); }),
    } as any,
  };
}

describe('ConsolidatedActionsExecutor', () => {
  it('un UPDATE por registro con todos sus campos; ingreso anulado lleva sellos de anulación', async () => {
    const plan: ActionPlan = {
      summary, warnings: [],
      changes: [
        { entityType: 'shipment', entityId: 'S1', trackingNumber: 'T1', field: 'active', oldValue: '1', newValue: '0', value: false },
        { entityType: 'income', entityId: 'I1', trackingNumber: 'T1', field: 'active', oldValue: '1', newValue: '0', value: false },
      ],
    };
    const { manager, queries, inserts } = makeManager();
    await new ConsolidatedActionsExecutor().apply(manager, plan, ctx);

    expect(queries[0].sql).toBe('UPDATE `shipment` SET `active` = ? WHERE id = ?');
    expect(queries[0].params).toEqual([0, 'S1']);
    const inc = queries[1];
    expect(inc.sql).toContain('UPDATE `income` SET `active` = ?');
    expect(inc.sql).toContain('`annulledAt` = ?');
    expect(inc.sql).toContain('`annulledById` = ?');
    expect(inc.sql).toContain('`editReason` = ?');
    expect(inc.params).toContain('Duplicado de Vía Larga');
    expect(inc.params[inc.params.length - 1]).toBe('I1');

    const ccl = inserts.find((i) => i.entity === ConsolidatedChangeLog)!;
    expect(ccl.rows).toHaveLength(2);
    expect(ccl.rows[0]).toMatchObject({ approvalRequestId: 'R1', entityType: 'shipment', field: 'active', oldValue: '1', newValue: '0', userName: 'Ana' });
    const icl = inserts.find((i) => i.entity === IncomeChangeLog)!;
    expect(icl.rows).toEqual([expect.objectContaining({ incomeId: 'I1', action: 'delete', reason: 'Duplicado de Vía Larga' })]);
  });

  it('agrupa varios campos del mismo ingreso en un solo UPDATE (sin anulación si no se da de baja)', async () => {
    const plan: ActionPlan = {
      summary, warnings: [],
      changes: [
        { entityType: 'income', entityId: 'I1', trackingNumber: 'T1', field: 'subsidiaryId', oldValue: 'OBR', newValue: 'CABO', value: 'CABO' },
        { entityType: 'income', entityId: 'I1', trackingNumber: 'T1', field: 'cost', oldValue: '64', newValue: '122', value: 122 },
      ],
    };
    const { manager, queries } = makeManager();
    await new ConsolidatedActionsExecutor().apply(manager, plan, ctx);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('`subsidiaryId` = ?, `cost` = ?');
    expect(queries[0].sql).not.toContain('annulledAt');
  });

  it('rechaza campos fuera de la lista blanca', async () => {
    const plan: ActionPlan = {
      summary, warnings: [],
      changes: [{ entityType: 'shipment', entityId: 'S1', trackingNumber: null, field: 'status', oldValue: null, newValue: 'x', value: 'x' }],
    };
    const { manager } = makeManager();
    await expect(new ConsolidatedActionsExecutor().apply(manager, plan, ctx)).rejects.toThrow(/no permitido/);
  });
});
