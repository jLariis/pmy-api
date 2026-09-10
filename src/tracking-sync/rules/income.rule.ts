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
    // Ignora eventos vetados (p.ej. pre-registro): no deben generar cobro.
    const newEvents = (ctx.reconcile.newEvents || []).filter((e) => !ctx.vetoedEventKeys.has(e.eventKey));
    if (newEvents.length === 0) return;

    // Solo consultamos los 08 previos si hay un 08 nuevo (evita un query por guía).
    // Necesitamos sus FECHAS (no solo el conteo) para agrupar por semana ISO: el cobro
    // exige 3 eventos 08 en la MISMA semana, no acumulados de forma corrida.
    const has08 = newEvents.some((e) => (e.exceptionCode ?? '').trim() === '08');
    let existing08Dates: Date[] = [];
    if (has08) {
      const rows = await this.dataSource.query(
        `SELECT timestamp FROM shipment_status WHERE shipmentId = ? AND exceptionCode = '08'`,
        [ctx.shipment.id],
      );
      existing08Dates = (rows ?? []).map((r: any) => new Date(r.timestamp));
    }

    const chargeables = deriveChargeableIncomes(newEvents, existing08Dates);
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
