import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * METADATA (espejo de shipments.service "GUARDADO EN CASCADA"): persiste los campos que FedEx
 * devuelve — `fedexUniqueId`, `carrierCode`, `receivedByName` — y, si hubo un DEX de CAMBIO DE
 * FECHA (17/84), sincroniza `commitDateTime` con la nueva fecha compromiso de FedEx.
 * Encola un efecto 'metadata'; el sink lo aplica (solo en cutover).
 */
@Injectable()
export class MetadataPersistRule implements SyncRule {
  readonly name = 'metadata-persist';
  readonly priority = 20;

  apply(ctx: SyncContext): void {
    const h = ctx.normalized.header;
    const payload: Record<string, any> = {};
    if (h.uniqueId) payload.uniqueId = h.uniqueId;
    if (h.carrierCode) payload.carrierCode = h.carrierCode;
    if (h.receivedByName) payload.receivedByName = h.receivedByName;

    // Cambio de fecha solicitada: si algún evento nuevo (no vetado) es CAMBIO_FECHA_SOLICITADO,
    // sincroniza commitDateTime con la fecha compromiso de FedEx (normalized.commitDateTime).
    const sawDateChange = (ctx.reconcile.newEvents || []).some(
      (e) => !ctx.vetoedEventKeys.has(e.eventKey) && e.status === ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
    );
    if (sawDateChange && ctx.normalized.commitDateTime) {
      payload.commitDateTime = ctx.normalized.commitDateTime.toISOString();
    }

    if (Object.keys(payload).length) ctx.deferredEffects.push({ type: 'metadata', payload });
  }
}
