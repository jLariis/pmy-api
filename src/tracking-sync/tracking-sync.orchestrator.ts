import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { ExistingEventLoader } from './existing-event-loader';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { ShadowSyncSink } from './sinks/shadow-sync.sink';
import { createLimit } from './concurrency.util';
import { IncomeReconciler } from './income/income-reconciler';
import { NormalizedEvent, RawTrackingResult, SyncContext, Trackable, TrackableItem } from './tracking-sync.types';

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
    private readonly incomeReconciler: IncomeReconciler,
  ) {}

  /** Acepta rastreables (normales y/o F2). Agrupa por (kind, trackingNumber). */
  async runShadow(items: TrackableItem[]) {
    const run = await this.runRepo.save(
      this.runRepo.create({ startedAt: new Date(), mode: 'shadow', total: items.length }),
    );

    // Clave por tipo+guía: un normal y un F2 con la misma guía se procesan por separado.
    const byKey = new Map<string, TrackableItem[]>();
    for (const it of items) {
      const key = `${it.kind}::${it.entity.trackingNumber}`;
      const arr = byKey.get(key) ?? [];
      arr.push(it);
      byKey.set(key, arr);
    }
    const keys = [...byKey.keys()];

    const limit = createLimit(TrackingSyncOrchestrator.CONCURRENCY);
    let ok = 0, noData = 0, failed = 0, matches = 0, diverges = 0;
    // Cobros en shadow: cuántos ingresos PROPONDRÍA el motor y cuántos faltan hoy (paridad).
    let cobrosWould = 0, cobrosMissing = 0;
    let aborted = false;

    for (let i = 0; i < keys.length; i += TrackingSyncOrchestrator.BATCH) {
      if (aborted) break;
      const batch = keys.slice(i, i + TrackingSyncOrchestrator.BATCH);

      let raws: RawTrackingResult[];
      try {
        raws = await this.source.fetch(batch.map((k) => this.refFor(byKey.get(k)![0].entity)));
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
        batch.map((key) =>
          limit(async () => {
            const item = byKey.get(key)![0];
            const raw = rawByTn.get(item.entity.trackingNumber);
            if (!raw || raw.trackResults.length === 0) { noData++; return; }
            try {
              const normalized = this.normalizer.normalize(raw);
              if (!normalized.latest) { noData++; return; }

              const entity = item.entity;
              const { keys: knownKeys, existing } = await this.loader.loadFull(entity.id, item.kind);
              const reconcile = this.reconciler.reconcile(
                normalized, knownKeys, entity.status, (e: NormalizedEvent) => e.shadowKey,
              );

              const ctx: SyncContext = {
                shipment: entity, kind: item.kind, normalized, reconcile, existing,
                proposedStatus: reconcile.proposedStatus,
                vetoedEventKeys: new Set<string>(), deferredEffects: [], notes: [],
              };
              await this.pipeline.run(ctx);
              const outcome = await this.sink.applyPlan(ctx, run.id);
              outcome.matchesLegacy ? matches++ : diverges++;
              // Reconciliación de cobros en shadow (no escribe): compara lo que el motor
              // cobraría contra los Income reales, anclado al evento terminal.
              if (ctx.deferredEffects.length) {
                const inc = await this.incomeReconciler.reconcile(ctx.deferredEffects);
                cobrosWould += inc.rows.length;
                cobrosMissing += inc.missingCount;
              }
              ok++;
            } catch (err: any) {
              failed++;
              this.logger.warn(`[${item.entity.trackingNumber}] shadow falló: ${err?.message}`);
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
    this.logger.log(`🧾 [shadow-cobros] propondría ${cobrosWould} (faltan ${cobrosMissing}, ya existen ${cobrosWould - cobrosMissing})`);
    return { runId: run.id, ok, noData, failed, aborted, cobrosWould, cobrosMissing };
  }

  private refFor(e: Trackable) {
    return { trackingNumber: e.trackingNumber, fedexUniqueId: e.fedexUniqueId, carrierCode: e.carrierCode };
  }

  private isConnectivity(err: any): boolean {
    const code = err?.code || '';
    return ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
  }
}
