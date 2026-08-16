import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { PersistentSyncSink, ApplyActor } from './sinks/persistent-sync.sink';
import { createLimit } from './concurrency.util';
import { buildShadowKey } from './event-key.util';
import { NormalizedEvent, SyncContext } from './tracking-sync.types';
import { ApplyOutcome, CompareResult, NormalizedEventDto } from './compare.types';

/**
 * Servicio READ-ONLY de comparación en vivo: contrasta nuestro estado almacenado
 * contra el último estado real de FedEx. No escribe nada (salvo `applyMany`, que
 * delega la escritura al PersistentSyncSink).
 */
@Injectable()
export class TrackingCompareService {
  private readonly logger = new Logger(TrackingCompareService.name);

  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ShipmentStatus) private readonly statusRepo: Repository<ShipmentStatus>,
    @InjectRepository(PackageDispatchHistory) private readonly dispatchHistoryRepo: Repository<PackageDispatchHistory>,
    private readonly source: FedexTrackingSource,
    private readonly normalizer: TrackingNormalizer,
    private readonly reconciler: EventReconciler,
    private readonly pipeline: SyncRulesPipeline,
    private readonly persistentSink: PersistentSyncSink,
  ) {}

  async compareByTracking(trackingNumber: string): Promise<CompareResult> {
    const shipment = await this.shipmentRepo.findOne({
      where: { trackingNumber },
      relations: ['subsidiary'],
      order: { createdAt: 'DESC' },
    });
    if (!shipment) {
      return this.emptyResult(trackingNumber, null, 'Guía no encontrada en el sistema');
    }
    return this.compareShipment(shipment);
  }

  async compareByRoute(routeId: string): Promise<CompareResult[]> {
    // Pertenencia HISTÓRICA: se lee de package_dispatch_history, no del FK vivo
    // shipment.routeId. Un paquete pudo reasignarse a otra ruta después; aún así
    // debe aparecer en la salida a ruta donde estuvo. (F2/chargeShipment fuera de alcance.)
    const history = await this.dispatchHistoryRepo.find({
      where: { dispatch: { id: routeId } },
      relations: ['shipment', 'shipment.subsidiary'],
    });
    const byId = new Map<string, Shipment>();
    for (const h of history) {
      if (h.shipment && !byId.has(h.shipment.id)) byId.set(h.shipment.id, h.shipment);
    }
    return this.compareMany([...byId.values()]);
  }

  async compareByConsolidated(consolidatedId: string): Promise<CompareResult[]> {
    const shipments = await this.shipmentRepo.find({
      where: { consolidatedId },
      relations: ['subsidiary'],
    });
    return this.compareMany(shipments);
  }

  async applyMany(shipmentIds: string[], actor: ApplyActor): Promise<ApplyOutcome[]> {
    const ids = [...new Set((shipmentIds || []).filter(Boolean))];
    const limit = createLimit(6); // concurrencia controlada hacia FedEx (sin tope de selección)
    return Promise.all(
      ids.map((id) =>
        limit(async () => {
          const shipment = await this.shipmentRepo.findOne({ where: { id }, relations: ['subsidiary'] });
          if (!shipment) {
            return {
              shipmentId: id, trackingNumber: '', applied: false,
              fromStatus: ShipmentStatusType.DESCONOCIDO, toStatus: null, insertedEvents: 0,
              skippedReason: 'Shipment no encontrado',
            };
          }
          const built = await this.buildContext(shipment);
          if (!built) {
            return {
              shipmentId: id, trackingNumber: shipment.trackingNumber, applied: false,
              fromStatus: shipment.status, toStatus: null, insertedEvents: 0,
              skippedReason: 'Sin datos FedEx',
            };
          }
          return this.persistentSink.applyPlan(built.ctx, actor);
        }),
      ),
    );
  }

  /** Núcleo reutilizable: compara un shipment ya cargado. */
  async compareShipment(shipment: Shipment): Promise<CompareResult> {
    try {
      const built = await this.buildContext(shipment);
      if (!built) {
        return this.emptyResult(shipment.trackingNumber, shipment, 'Sin datos en FedEx');
      }

      const { ctx, ourLastEventAt } = built;
      const fedexLastEventAt = ctx.normalized.latest ? ctx.normalized.latest.occurredAt.toISOString() : null;
      const diverges = ctx.proposedStatus != null && ctx.proposedStatus !== shipment.status;
      const isStale = !!fedexLastEventAt && (ourLastEventAt == null || fedexLastEventAt > ourLastEventAt);

      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        ourStatus: shipment.status,
        ourLastEventAt,
        fedexStatus: ctx.proposedStatus,
        fedexLastEventAt,
        diverges,
        isStale,
        missingEvents: ctx.reconcile.newEvents.map(this.toDto),
        fedexEvents: ctx.normalized.events.map(this.toDto),
        issues: ctx.normalized.validation.issues,
      };
    } catch (err: any) {
      this.logger.warn(`compareShipment ${shipment.trackingNumber}: ${err?.message}`);
      return this.emptyResult(shipment.trackingNumber, shipment, err?.message ?? 'Error consultando FedEx');
    }
  }

  /**
   * Consulta FedEx, normaliza, reconcilia contra nuestro historial y corre las reglas.
   * Devuelve el contexto listo (para comparar o aplicar) + la fecha de nuestro último
   * evento. `null` si FedEx no devolvió datos.
   */
  private async buildContext(
    shipment: Shipment,
  ): Promise<{ ctx: SyncContext & { normalized: any; reconcile: any }; ourLastEventAt: string | null } | null> {
    const [raw] = await this.source.fetch([
      { trackingNumber: shipment.trackingNumber, fedexUniqueId: shipment.fedexUniqueId, carrierCode: shipment.carrierCode },
    ]);
    if (!raw || raw.trackResults.length === 0) return null;

    const normalized = this.normalizer.normalize(raw);
    const rows = await this.statusRepo.find({
      where: { shipment: { id: shipment.id } },
      select: ['timestamp', 'exceptionCode', 'status'],
    });
    const knownKeys = new Set(
      rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)),
    );
    const ourLastEventAt = rows.length
      ? new Date(Math.max(...rows.map((r) => new Date(r.timestamp).getTime()))).toISOString()
      : null;

    const reconcile = this.reconciler.reconcile(
      normalized, knownKeys, shipment.status, (e: NormalizedEvent) => e.shadowKey,
    );

    const ctx: SyncContext = {
      shipment, normalized, reconcile,
      proposedStatus: reconcile.proposedStatus,
      vetoedEventKeys: new Set<string>(), deferredEffects: [], notes: [],
    };
    await this.pipeline.run(ctx);

    return { ctx, ourLastEventAt };
  }

  private async compareMany(shipments: Shipment[]): Promise<CompareResult[]> {
    // Paralelizado con concurrencia controlada: una ruta/consolidado con muchas guías
    // consultaba FedEx en serie (lentísimo, con riesgo de timeout del request). Aquí
    // corren hasta 6 comparaciones a la vez, preservando el orden de entrada.
    const limit = createLimit(6);
    return Promise.all(shipments.map((s) => limit(() => this.compareShipment(s))));
  }

  private toDto(e: NormalizedEvent): NormalizedEventDto {
    return {
      occurredAt: e.occurredAt.toISOString(),
      status: e.status,
      derivedCode: e.derivedCode,
      exceptionCode: e.exceptionCode,
      description: e.description,
      location: e.location,
    };
  }

  private emptyResult(trackingNumber: string, shipment: Shipment | null, error: string): CompareResult {
    return {
      shipmentId: shipment?.id ?? '',
      trackingNumber,
      ourStatus: shipment?.status ?? ShipmentStatusType.DESCONOCIDO,
      ourLastEventAt: null,
      fedexStatus: null,
      fedexLastEventAt: null,
      diverges: false,
      isStale: false,
      missingEvents: [],
      fedexEvents: [],
      issues: [error],
      error,
    };
  }
}
