import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * TIME SHIELD (espejo de shipments.service §5): solo tomamos el estatus de FedEx si su evento
 * más reciente es POSTERIOR a nuestra última operación interna (lastOpTime). Si no, conservamos
 * el estatus interno (no dejamos que un evento viejo de FedEx pise una salida a ruta reciente).
 * Excepción: ENTREGADO siempre gana. Corre después de delivery-header (95).
 */
@Injectable()
export class TimeShieldRule implements SyncRule {
  readonly name = 'time-shield';
  readonly priority = 80;

  apply(ctx: SyncContext): void {
    if (ctx.proposedStatus === ShipmentStatusType.ENTREGADO) return; // entrega siempre gana
    const newestEventTime = ctx.normalized.latest?.occurredAt?.getTime() ?? 0;
    if (newestEventTime > ctx.existing.lastOpTime) return; // FedEx es más nuevo → se respeta

    // FedEx NO es más nuevo que nuestra última operación interna → conservamos el actual.
    if (ctx.proposedStatus !== ctx.shipment.status) {
      ctx.notes.push(`Time Shield: se conserva ${ctx.shipment.status} (evento FedEx no es más reciente que la op. interna)`);
      ctx.proposedStatus = ctx.shipment.status;
    }
  }
}
