import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * SAFETY-NET DE COBRO POR HEADER (espejo de shipments.service "Header Backup"): si FedEx marca
 * ENTREGADO en el ENCABEZADO (DL) pero NO hay un evento de entrega entre los eventos nuevos,
 * igual se genera el cobro de ENTREGADO, anclado a una llave estable del header (idempotente por
 * sourceEventKey). Solo envíos (las cargas no cobran). Corre justo antes de IncomeRule.
 */
@Injectable()
export class IncomeHeaderSafetyNetRule implements SyncRule {
  readonly name = 'income-header-safety-net';
  readonly priority = 11;

  apply(ctx: SyncContext): void {
    if (ctx.kind !== 'shipment') return;
    if (!ctx.normalized.header.isDeliveredHeader) return;

    const events = (ctx.reconcile.newEvents || []).filter((e) => !ctx.vetoedEventKeys.has(e.eventKey));
    const hasDeliveredEvent = events.some((e) => e.status === ShipmentStatusType.ENTREGADO);
    if (hasDeliveredEvent) return; // IncomeRule ya lo cubre por evento

    const when = ctx.normalized.header.actualDeliveryAt ?? ctx.normalized.latest?.occurredAt ?? new Date();
    const day = when.toISOString().slice(0, 10);
    ctx.deferredEffects.push({
      type: 'income',
      payload: {
        eventKey: `HDR-DL:${ctx.shipment.trackingNumber}:${day}`,
        incomeType: IncomeStatus.ENTREGADO,
        occurredAt: when,
        exceptionCode: 'DL',
        reason: 'ENTREGADO (header DL)',
        trackingNumber: ctx.shipment.trackingNumber,
        shipmentId: ctx.shipment.id,
        subsidiaryId: (ctx.shipment.subsidiary as any)?.id ?? null,
      },
    });
  }
}
