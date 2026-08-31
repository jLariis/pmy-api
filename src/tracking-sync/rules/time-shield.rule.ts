import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * TIME SHIELD (espejo de shipments.service §5): solo tomamos el estatus de FedEx si su evento
 * más reciente es POSTERIOR a nuestra última operación interna (lastOpTime). Si no, conservamos
 * el estatus interno (no dejamos que un evento viejo de FedEx pise una salida a ruta reciente).
 *
 * Excepciones (el escudo NO aplica → FedEx gana):
 *  - ENTREGADO siempre gana.
 *  - Bodega-FedEx (`allowSameDayPreRegistrationFedexEvents`): un evento FedEx del MISMO DÍA
 *    calendario (Hermosillo) gana aunque sea anterior al EN_RUTA, porque en esas sucursales la
 *    salida a ruta se captura TARDE (el reparto físico ya ocurrió). Ver spec §3.5 (arista B).
 *
 * Corre después de delivery-header (95).
 */
@Injectable()
export class TimeShieldRule implements SyncRule {
  readonly name = 'time-shield';
  readonly priority = 80;

  apply(ctx: SyncContext): void {
    if (ctx.proposedStatus === ShipmentStatusType.ENTREGADO) return; // entrega siempre gana

    const newest = ctx.normalized.latest;
    const newestEventTime = newest?.occurredAt?.getTime() ?? 0;
    if (newestEventTime > ctx.existing.lastOpTime) return; // FedEx es más nuevo → se respeta

    // Bodega-FedEx: evento FedEx del MISMO DÍA gana sobre el EN_RUTA de captura tardía.
    const allowPreReg = !!(ctx.shipment.subsidiary as any)?.allowSameDayPreRegistrationFedexEvents;
    if (allowPreReg && newest && toHermosilloDateString(newest.occurredAt) === toHermosilloDateString(new Date())) {
      ctx.notes.push('Bodega-FedEx: evento del mismo día gana sobre EN_RUTA de captura tardía');
      return;
    }

    // FedEx NO es más nuevo que nuestra última operación interna → conservamos el actual.
    if (ctx.proposedStatus !== ctx.shipment.status) {
      ctx.notes.push(`Time Shield: se conserva ${ctx.shipment.status} (evento FedEx no es más reciente que la op. interna)`);
      ctx.proposedStatus = ctx.shipment.status;
    }
  }
}
