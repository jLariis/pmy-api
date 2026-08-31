import { Injectable } from '@nestjs/common';
import { DeferredEffect } from '../tracking-sync.types';
import { IncomeExecutor } from './income-executor';

export interface IncomeReconcileRow {
  trackingNumber: string;
  incomeType: string;
  sourceEventKey: string;
  wouldGenerate: boolean;
  alreadyExists: boolean;
  missing: boolean;
  cost: number;
}

/**
 * Reconciliador de cobros en SHADOW: calcula (sin escribir) los ingresos que el motor
 * generaría desde los efectos encolados y los compara con los `Income` reales.
 *  - missing  = el motor cobraría algo que HOY no existe (posible cobro que el legacy no captó
 *               o divergencia a revisar antes del cutover).
 *  - alreadyExists = ya existe (paridad con el legacy).
 */
@Injectable()
export class IncomeReconciler {
  constructor(private readonly executor: IncomeExecutor) {}

  async reconcile(effects: DeferredEffect[]): Promise<{ rows: IncomeReconcileRow[]; missingCount: number; okCount: number }> {
    const proposed = await this.executor.execute(effects, 'report');
    const rows: IncomeReconcileRow[] = proposed.map((p) => ({
      trackingNumber: p.trackingNumber,
      incomeType: String(p.incomeType),
      sourceEventKey: p.sourceEventKey,
      wouldGenerate: true,
      alreadyExists: p.exists,
      missing: !p.exists,
      cost: p.cost,
    }));
    const missingCount = rows.filter((r) => r.missing).length;
    return { rows, missingCount, okCount: rows.length - missingCount };
  }
}
