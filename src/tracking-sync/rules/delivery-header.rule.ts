import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Prioridad de entrega ABSOLUTA (espejo de shipments.service §4): si FedEx marca DL en el
 * ENCABEZADO (aunque aún no inyecte el scanEvent), el estatus es ENTREGADO. Corre después de
 * terminal-lock (100) para poder sobreescribir cualquier otro terminal (DL siempre gana).
 */
@Injectable()
export class DeliveryHeaderRule implements SyncRule {
  readonly name = 'delivery-header';
  readonly priority = 95;

  apply(ctx: SyncContext): void {
    if (ctx.normalized.header.isDeliveredHeader && ctx.proposedStatus !== ShipmentStatusType.ENTREGADO) {
      ctx.proposedStatus = ShipmentStatusType.ENTREGADO;
      ctx.notes.push('Entrega por header (DL) → ENTREGADO');
    }
  }
}
