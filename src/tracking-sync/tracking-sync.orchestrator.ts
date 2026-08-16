import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { ExistingEventLoader } from './existing-event-loader';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { ShadowSyncSink } from './sinks/shadow-sync.sink';
import { createLimit } from './concurrency.util';
import { NormalizedEvent, RawTrackingResult, SyncContext } from './tracking-sync.types';

/**
 * Conduce el pipeline sobre muchas guías: batching, concurrencia controlada, circuit
 * breaker por conectividad, dead-letter y métricas por corrida (tracking_sync_run).
 */
@Injectable()
export class TrackingSyncOrchestrator {
  private readonly logger = new Logger(TrackingSyncOrchestrator.name);
  private static readonly BATCH = 250;
  private static readonly CONCURRENCY = 6;

  constructor(
    @InjectRepository(TrackingSyncRun) private readonly runRepo: Repository<TrackingSyncRun>,
    private readonly source: FedexTrackingSource,
    private readonly normalizer: TrackingNormalizer,
    private readonly reconciler: EventReconciler,
    private readonly pipeline: SyncRulesPipeline,
    private readonly sink: ShadowSyncSink,
    private readonly loader: ExistingEventLoader,
  ) {}

  async runShadow(shipments: Shipment[]) {
    const run = await this.runRepo.save(
      this.runRepo.create({ startedAt: new Date(), mode: 'shadow', total: shipments.length }),
    );

    const byTracking = new Map<string, Shipment[]>();
    for (const s of shipments) {
      const arr = byTracking.get(s.trackingNumber) ?? [];
      arr.push(s);
      byTracking.set(s.trackingNumber, arr);
    }
    const trackingNumbers = [...byTracking.keys()];

    const limit = createLimit(TrackingSyncOrchestrator.CONCURRENCY);
    let ok = 0, noData = 0, failed = 0, matches = 0, diverges = 0;
    let aborted = false;

    for (let i = 0; i < trackingNumbers.length; i += TrackingSyncOrchestrator.BATCH) {
      if (aborted) break;
      const batch = trackingNumbers.slice(i, i + TrackingSyncOrchestrator.BATCH);

      let raws: RawTrackingResult[];
      try {
        raws = await this.source.fetch(batch.map((tn) => this.refFor(byTracking.get(tn)![0])));
      } catch (err: any) {
        this.logger.error(`Fallo de fetch en lote: ${err?.message}`);
        if (ok === 0 && this.isConnectivity(err)) {
          aborted = true;
          break;
        }
        continue;
      }

      const rawByTn = new Map(raws.map((r) => [r.trackingNumber, r]));

      await Promise.all(
        batch.map((tn) =>
          limit(async () => {
            const raw = rawByTn.get(tn);
            const group = byTracking.get(tn)!;
            if (!raw || raw.trackResults.length === 0) { noData++; return; }
            try {
              const normalized = this.normalizer.normalize(raw);
              if (!normalized.latest) { noData++; return; }

              const shipment = group[0];
              const knownKeys = await this.loader.load(shipment.id);
              const reconcile = this.reconciler.reconcile(
                normalized, knownKeys, shipment.status, (e: NormalizedEvent) => e.shadowKey,
              );

              const ctx: SyncContext = {
                shipment, normalized, reconcile,
                proposedStatus: reconcile.proposedStatus,
                vetoedEventKeys: new Set<string>(), deferredEffects: [], notes: [],
              };
              await this.pipeline.run(ctx);
              const outcome = await this.sink.applyPlan(ctx, run.id);
              outcome.matchesLegacy ? matches++ : diverges++;
              ok++;
            } catch (err: any) {
              failed++;
              this.logger.warn(`[${tn}] shadow falló: ${err?.message}`);
            }
          }),
        ),
      );
    }

    run.finishedAt = new Date();
    run.ok = ok; run.noData = noData; run.failed = failed;
    run.aborted = aborted; run.matchesLegacy = matches; run.divergesLegacy = diverges;
    await this.runRepo.save(run);

    this.logger.log(`🏁 [shadow] run ${run.id}: ok=${ok} noData=${noData} failed=${failed} match=${matches} diverge=${diverges} aborted=${aborted}`);
    return { runId: run.id, ok, noData, failed, aborted };
  }

  private refFor(s: Shipment) {
    return { trackingNumber: s.trackingNumber, fedexUniqueId: s.fedexUniqueId, carrierCode: s.carrierCode };
  }

  private isConnectivity(err: any): boolean {
    const code = err?.code || '';
    return ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
  }
}
