import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SyncContext, SyncRule } from '../tracking-sync.types';
import { deriveChargeableIncomes } from './income.chargeable';

/**
 * HOOK FINANCIERO — encola efectos de cobro (DeferredEffect type:'income') anclados al
 * evento terminal de FedEx. NO escribe: el IncomeExecutor los materializa (report en
 * shadow, persist en cutover). Solo aplica a envíos normales; las cargas F2 no cobran
 * por paquete. Prioridad baja (10): corre al final, con el proposedStatus ya resuelto.
 */
@Injectable()
export class IncomeRule implements SyncRule {
  readonly name = 'income';
  readonly priority = 10;

  constructor(private readonly dataSource: DataSource) {}

  async apply(ctx: SyncContext): Promise<void> {
    if (ctx.kind !== 'shipment') return;
    const newEvents = ctx.reconcile.newEvents || [];
    if (newEvents.length === 0) return;

    // Solo consultamos el conteo de 08 previos si hay un 08 nuevo (evita un query por guía).
    const has08 = newEvents.some((e) => (e.exceptionCode ?? '').trim() === '08');
    let existing08 = 0;
    if (has08) {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS c FROM shipment_status WHERE shipmentId = ? AND exceptionCode = '08'`,
        [ctx.shipment.id],
      );
      existing08 = Number(rows?.[0]?.c ?? 0);
    }

    const chargeables = deriveChargeableIncomes(newEvents, existing08);
    for (const ci of chargeables) {
      ctx.deferredEffects.push({
        type: 'income',
        payload: {
          ...ci,
          trackingNumber: ctx.shipment.trackingNumber,
          shipmentId: ctx.shipment.id,
          subsidiaryId: (ctx.shipment.subsidiary as any)?.id ?? null,
        },
      });
    }
  }
}
