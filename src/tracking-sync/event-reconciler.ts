import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { NormalizedEvent, NormalizedTracking, ReconcileResult } from './tracking-sync.types';

/**
 * Diff puro: dados los eventos normalizados y el set de claves ya conocidas, devuelve
 * los eventos nuevos (asc por fecha) y el estatus propuesto (último evento). Sin BD.
 * `keyOf` selecciona la clave a comparar (shadowKey en shadow, eventKey en cutover).
 */
@Injectable()
export class EventReconciler {
  reconcile(
    normalized: NormalizedTracking,
    knownKeys: Set<string>,
    currentStatus: ShipmentStatusType,
    keyOf: (e: NormalizedEvent) => string,
  ): ReconcileResult {
    const newEvents = normalized.events.filter((e) => !knownKeys.has(keyOf(e)));
    const proposedStatus = normalized.latest?.status ?? null;
    const transition =
      proposedStatus && proposedStatus !== currentStatus
        ? { from: currentStatus, to: proposedStatus }
        : null;

    return { newEvents, proposedStatus, currentStatus, transition };
  }
}
