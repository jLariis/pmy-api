import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { SyncContext, SyncRule } from '../tracking-sync.types';

const PREREG_RESOLVED = new Set<ShipmentStatusType>([
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  ShipmentStatusType.DIRECCION_INCORRECTA,
  ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
  ShipmentStatusType.NO_ENTREGADO,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
]);
const OPERATIONAL = new Set<ShipmentStatusType>([
  ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA, ShipmentStatusType.EN_RUTA,
]);

/**
 * PRE-REGISTRO — reflejar DEX resuelto (espejo de shipments.service §6.5): si hubo un DEX
 * RESUELTO (rechazado/no-disp/dirección/cambio-fecha/no-entregado/devuelto) el MISMO DÍA,
 * ANTES de `createdAt`, y nada más reciente cambió el estatus (sigue igual al actual y es
 * operativo), ése es el estatus REAL (FedEx ya tiene el paquete). Solo bodega-FedEx.
 * Corre después de time-shield/external (prioridad 40).
 */
@Injectable()
export class PreRegResolvedRule implements SyncRule {
  readonly name = 'pre-reg-resolved';
  readonly priority = 40;

  apply(ctx: SyncContext): void {
    const allowPreReg = !!(ctx.shipment.subsidiary as any)?.allowSameDayPreRegistrationFedexEvents;
    if (!allowPreReg) return;
    const createdAt = (ctx.shipment as any)?.createdAt ? new Date((ctx.shipment as any).createdAt) : null;
    if (!createdAt || isNaN(createdAt.getTime())) return;
    const createdAtTime = createdAt.getTime();
    const createdAtDay = toHermosilloDateString(createdAt);

    // DEX resuelto pre-registro más reciente (mismo día, antes de createdAt).
    let resolved: ShipmentStatusType | null = null;
    let resolvedTime = -1;
    for (const e of ctx.reconcile.newEvents) {
      const t = e.occurredAt.getTime();
      if (t >= createdAtTime) continue;
      if (toHermosilloDateString(e.occurredAt) !== createdAtDay) continue;
      if (!PREREG_RESOLVED.has(e.status)) continue;
      if (t >= resolvedTime) { resolvedTime = t; resolved = e.status; }
    }
    if (!resolved) return;

    // Solo si nada más reciente cambió el estatus (sigue igual al actual y es operativo).
    if (ctx.proposedStatus === ctx.shipment.status && OPERATIONAL.has(ctx.proposedStatus as ShipmentStatusType)) {
      ctx.notes.push(`Pre-registro: ${ctx.proposedStatus} → ${resolved} (DEX del mismo día previo al registro)`);
      ctx.proposedStatus = resolved;
    }
  }
}
