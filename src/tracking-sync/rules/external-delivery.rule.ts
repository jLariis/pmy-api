import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Entrega por terceros (OD) según config de la sucursal (`trackFedexExternalDelivery`).
 * Si la sucursal lo rastrea y hay evento OD: en tránsito → ACARGO_DE_FEDEX;
 * entregado → ENTREGADO_POR_FEDEX. Si no lo rastrea, no hace nada.
 */
@Injectable()
export class ExternalDeliveryRule implements SyncRule {
  readonly name = 'external-delivery';
  readonly priority = 50;

  apply(ctx: SyncContext): void {
    const tracksExternal = !!(ctx.shipment.subsidiary as any)?.trackFedexExternalDelivery;
    if (!tracksExternal) return;

    const hasOd = ctx.normalized.events.some(
      (e: any) => e.eventType === 'OD' || e.derivedCode === 'OD',
    );
    if (!hasOd) return;

    if (ctx.proposedStatus === ShipmentStatusType.ENTREGADO) {
      ctx.proposedStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
      ctx.notes.push('OD: entrega por terceros → ENTREGADO_POR_FEDEX');
    } else if (ctx.proposedStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
      ctx.proposedStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
      ctx.notes.push('OD: FedEx tomó control → ACARGO_DE_FEDEX');
    }
  }
}
