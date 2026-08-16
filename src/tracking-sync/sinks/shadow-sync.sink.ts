import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';
import { SinkOutcome, SyncContext, SyncSink } from '../tracking-sync.types';

/**
 * Sink de SHADOW: NO toca shipment ni shipment_status. Registra en tracking_sync_observation
 * lo que el motor HARÍA. Idempotente por (runId, shipmentId) vía upsert.
 */
@Injectable()
export class ShadowSyncSink implements SyncSink {
  constructor(
    @InjectRepository(TrackingSyncObservation)
    private readonly observationRepo: Repository<TrackingSyncObservation>,
  ) {}

  async applyPlan(ctx: SyncContext, runId: string): Promise<SinkOutcome> {
    const toInsert = ctx.reconcile.newEvents.filter((e) => !ctx.vetoedEventKeys.has(e.eventKey));
    const matchesLegacy = ctx.proposedStatus === ctx.shipment.status;

    const row = {
      runId,
      shipmentId: ctx.shipment.id,
      trackingNumber: ctx.shipment.trackingNumber,
      proposedStatus: ctx.proposedStatus ?? null,
      legacyCurrentStatus: ctx.shipment.status ?? null,
      wouldInsertEvents: toInsert.length,
      wouldInsertEventKeys: JSON.stringify(toInsert.map((e) => e.eventKey)),
      matchesLegacy,
      issues: JSON.stringify(ctx.normalized.validation.issues ?? []),
    };

    await this.observationRepo.upsert(row as any, ['runId', 'shipmentId']);

    return {
      shipmentId: ctx.shipment.id,
      trackingNumber: ctx.shipment.trackingNumber,
      proposedStatus: ctx.proposedStatus,
      wouldInsertEvents: toInsert.length,
      matchesLegacy,
    };
  }
}
