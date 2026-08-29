import { Injectable } from '@nestjs/common';
import { toHermosilloDateString } from 'src/common/utils';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * BLINDAJE PRE-REGISTRO (espejo de shipments.service §"newEvents"): un evento FedEx ANTERIOR a
 * `createdAt` ocurrió antes de que el paquete existiera en el sistema (posible operación previa /
 * guía reutilizada) → por defecto NO se inserta. EXCEPCIÓN: sucursales de bodega-FedEx
 * (`allowSameDayPreRegistrationFedexEvents`) SÍ lo procesan si ocurrió el MISMO DÍA calendario
 * (zona Hermosillo) que `createdAt`. Veta los eventos excluidos (no toca el estatus).
 */
@Injectable()
export class PreRegistrationRule implements SyncRule {
  readonly name = 'pre-registration';
  readonly priority = 60;

  apply(ctx: SyncContext): void {
    const createdAt = (ctx.shipment as any)?.createdAt ? new Date((ctx.shipment as any).createdAt) : null;
    if (!createdAt || isNaN(createdAt.getTime())) return;
    const createdAtTime = createdAt.getTime();
    const createdAtDay = toHermosilloDateString(createdAt);
    const allowPreReg = !!(ctx.shipment.subsidiary as any)?.allowSameDayPreRegistrationFedexEvents;

    for (const e of ctx.reconcile.newEvents) {
      const t = e.occurredAt.getTime();
      if (t >= createdAtTime) continue; // no es pre-registro
      const sameDay = toHermosilloDateString(e.occurredAt) === createdAtDay;
      if (!(allowPreReg && sameDay)) {
        ctx.vetoedEventKeys.add(e.eventKey);
      }
    }
  }
}
