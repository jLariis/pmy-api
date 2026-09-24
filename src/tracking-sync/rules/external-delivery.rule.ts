import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';
import { isOurRouteDelivery } from 'src/common/our-route-delivery.util';

/**
 * Entrega por terceros (OD) según config de la sucursal (`trackFedexExternalDelivery`).
 * Si la sucursal lo rastrea y hay evento OD: en tránsito → ACARGO_DE_FEDEX;
 * entregado → ENTREGADO_POR_FEDEX. Si no lo rastrea, no hace nada.
 *
 * Excepción (manda sobre todo): si la entrega fue el MISMO día de una ruta NUESTRA y la guía
 * está en un consolidado nuestro, la entregamos nosotros → ENTREGADO, aunque FedEx la marque
 * por terceros (005) o haya un OD viejo (ver our-route-delivery.util).
 */
@Injectable()
export class ExternalDeliveryRule implements SyncRule {
  readonly name = 'external-delivery';
  readonly priority = 50;

  apply(ctx: SyncContext): void {
    if (
      (ctx.proposedStatus === ShipmentStatusType.ENTREGADO || ctx.proposedStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX) &&
      this.isOurDelivery(ctx)
    ) {
      if (ctx.proposedStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX) ctx.notes.push('Entrega en ruta nuestra el mismo día → ENTREGADO (no por FedEx)');
      ctx.proposedStatus = ShipmentStatusType.ENTREGADO;
      return;
    }

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

  /** Último DL de FedEx (o la fecha de entrega del header) vs las rutas nuestras de la guía. */
  private isOurDelivery(ctx: SyncContext): boolean {
    const dls = ctx.normalized.events.filter((e: any) => (e.eventType === 'DL' || e.derivedCode === 'DL') && e.occurredAt);
    const lastDl = dls.sort((a: any, b: any) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0];
    const deliveredAt = lastDl ? new Date((lastDl as any).occurredAt) : ctx.normalized.header?.actualDeliveryAt ? new Date(ctx.normalized.header.actualDeliveryAt) : null;
    const s: any = ctx.shipment;
    return isOurRouteDelivery({
      deliveredAt,
      routeDays: ctx.existing.ourRouteDays ?? [],
      hasConsolidado: ctx.kind === 'charge' ? !!(s.chargeId || s.charge || s.consolidatedId) : !!(s.consolidatedId || s.consolidated),
    });
  }
}
