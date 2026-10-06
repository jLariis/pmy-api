import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ConsolidatedChangeLog } from 'src/entities/consolidated-change-log.entity';
import { IncomeChangeLog } from 'src/entities/income-change-log.entity';
import { ActionPlan, ChangeEntity, FieldChange } from './consolidated-actions.types';

const TABLE: Record<ChangeEntity, string> = {
  consolidated: 'consolidated',
  shipment: 'shipment',
  charge_shipment: 'charge_shipment',
  charge: 'charge',
  income: 'income',
  devolution: 'devolution',
};

/** Columnas que el plan puede escribir (lista blanca: nada fuera de aquí llega al UPDATE). */
const ALLOWED_FIELDS = new Set([
  'active', 'subsidiaryId', 'date', 'chargeDate', 'cost', 'originalCost', 'secondAbordApplied', 'chargeNotChargedSameDay',
]);

/** Acción del historial del Consolidador según el campo del ingreso que cambió. */
const INCOME_LOG_ACTION: Record<string, string> = {
  active: 'delete',
  subsidiaryId: 'reassign',
  cost: 'cost_edit',
  date: 'date_edit',
  secondAbordApplied: 'second_abord',
  chargeNotChargedSameDay: 'cost_edit',
};

export interface ExecutionContext {
  requestId: string;
  action: string;
  consNumber: string;
  userId: string | null;
  userName: string | null;
  /** Motivo que queda en cada ingreso tocado (`editReason`) y en el historial. */
  reason: string;
}

const toDb = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const chunk = <T>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Aplica un `ActionPlan` dentro de la transacción recibida: un UPDATE por registro (con todos sus
 * campos), sellos de auditoría en los ingresos (quién, cuándo, por qué; anulación si se da de
 * baja) y la bitácora (`consolidated_change_log` + historial de ingresos del Consolidador).
 */
@Injectable()
export class ConsolidatedActionsExecutor {
  async apply(manager: EntityManager, plan: ActionPlan, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const groups = new Map<string, { entityType: ChangeEntity; entityId: string; changes: FieldChange[] }>();
    for (const c of plan.changes) {
      if (!ALLOWED_FIELDS.has(c.field)) throw new Error(`Campo no permitido en el plan: ${c.field}`);
      const key = `${c.entityType}:${c.entityId}`;
      const g = groups.get(key) ?? { entityType: c.entityType, entityId: c.entityId, changes: [] };
      g.changes.push(c);
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      const patch: Record<string, unknown> = {};
      for (const c of g.changes) patch[c.field] = toDb(c.value);
      if (g.entityType === 'income') {
        patch.updatedById = ctx.userId;
        patch.updatedAt = now;
        patch.editReason = ctx.reason.slice(0, 255);
        if (g.changes.some((c) => c.field === 'active' && c.value === false)) {
          patch.annulledAt = now;
          patch.annulledById = ctx.userId;
        }
      }
      const cols = Object.keys(patch);
      await manager.query(
        `UPDATE \`${TABLE[g.entityType]}\` SET ${cols.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((k) => patch[k]), g.entityId],
      );
    }

    const logs = plan.changes.map((c) => ({
      approvalRequestId: ctx.requestId,
      action: ctx.action,
      consNumber: ctx.consNumber,
      entityType: c.entityType,
      entityId: c.entityId,
      trackingNumber: c.trackingNumber,
      field: c.field,
      oldValue: c.oldValue?.slice(0, 255) ?? null,
      newValue: c.newValue?.slice(0, 255) ?? null,
      userId: ctx.userId,
      userName: ctx.userName,
      createdAt: now,
    }));
    for (const part of chunk(logs, 200)) await manager.insert(ConsolidatedChangeLog, part);

    const incomeLogs = plan.changes
      .filter((c) => c.entityType === 'income')
      .map((c) => ({
        incomeId: c.entityId,
        shipmentId: null,
        action: INCOME_LOG_ACTION[c.field] ?? 'cost_edit',
        field: c.field,
        oldValue: c.oldValue?.slice(0, 255) ?? null,
        newValue: c.newValue?.slice(0, 255) ?? null,
        reason: ctx.reason.slice(0, 255),
        userId: ctx.userId,
      }));
    for (const part of chunk(incomeLogs, 200)) await manager.insert(IncomeChangeLog, part);
  }
}
