import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
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
import { NormalizedEvent, SyncContext, Trackable, TrackableKind } from './tracking-sync.types';
import { ApplyOutcome, CompareResult, NormalizedEventDto } from './compare.types';
import { computeEffectiveLastOpTime, DispatchAnchor } from './route-op-time.util';

interface CompareItem {
  entity: Trackable;
  kind: TrackableKind;
}

/**
 * Servicio READ-ONLY de comparación en vivo: contrasta nuestro estado almacenado
 * contra el último estado real de FedEx. Soporta envíos normales (Shipment) y F2
 * (ChargeShipment). No escribe nada (salvo `applyMany`, que delega al PersistentSyncSink).
 */
@Injectable()
export class TrackingCompareService {
  private readonly logger = new Logger(TrackingCompareService.name);

  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
    @InjectRepository(ShipmentStatus) private readonly statusRepo: Repository<ShipmentStatus>,
    @InjectRepository(PackageDispatchHistory) private readonly dispatchHistoryRepo: Repository<PackageDispatchHistory>,
    private readonly source: FedexTrackingSource,
    private readonly normalizer: TrackingNormalizer,
    private readonly reconciler: EventReconciler,
    private readonly pipeline: SyncRulesPipeline,
    private readonly persistentSink: PersistentSyncSink,
  ) {}

  async compareByTracking(trackingNumber: string): Promise<CompareResult> {
    const ship = await this.shipmentRepo.findOne({
      where: { trackingNumber },
      relations: ['subsidiary'],
      order: { createdAt: 'DESC' },
    });
    if (ship) return this.compareTrackable(ship, 'shipment');

    const charge = await this.chargeRepo.findOne({
      where: { trackingNumber },
      relations: ['subsidiary'],
      order: { createdAt: 'DESC' },
    });
    if (charge) return this.compareTrackable(charge, 'charge');

    return this.emptyResult(trackingNumber, null, 'shipment', 'Guía no encontrada en el sistema');
  }

  async compareByRoute(routeId: string): Promise<CompareResult[]> {
    return this.compareManyItems(await this.gatherRouteItems(routeId));
  }

  /**
   * Reconcilia y PERSISTE (status-only) todas las guías de una salida a ruta contra FedEx.
   * Es el "compareByRoute + applyMany" en UNA sola pasada (una llamada FedEx por paquete),
   * pensado para correr AL ABRIR el cierre a ruta: deja el estatus almacenado alineado con
   * el último estatus real de FedEx antes de clasificar buckets, así el `en_ruta` interno
   * recién puesto ya no puede "ganarle" al estatus real del mismo día.
   *
   * `opts.kinds` limita qué tipos se tocan: en rutas 31.5 (todo F2) se pasa `['charge']`
   * para NO revalidar los shipments normales. Nunca lanza: cada paquete resuelve su propio
   * outcome (skipped si FedEx no dio datos), para que abrir el cierre no se rompa si FedEx falla.
   */
  async applyByRoute(
    routeId: string,
    actor: ApplyActor,
    opts: { kinds?: TrackableKind[] } = {},
  ): Promise<ApplyOutcome[]> {
    let items = await this.gatherRouteItems(routeId);
    if (opts.kinds?.length) {
      const allowed = new Set(opts.kinds);
      items = items.filter((it) => allowed.has(it.kind));
    }
    const limit = createLimit(6);
    return Promise.all(
      items.map((it) =>
        limit(async () => {
          try {
            const built = await this.buildContext(it.entity, it.kind);
            if (!built) {
              return {
                shipmentId: it.entity.id,
                trackingNumber: it.entity.trackingNumber,
                applied: false,
                fromStatus: it.entity.status,
                toStatus: null,
                insertedEvents: 0,
                kind: it.kind,
                skippedReason: 'Sin datos FedEx',
              } as ApplyOutcome;
            }
            return this.persistentSink.applyPlan(built.ctx, actor);
          } catch (err: any) {
            return {
              shipmentId: it.entity.id,
              trackingNumber: it.entity.trackingNumber,
              applied: false,
              fromStatus: it.entity.status,
              toStatus: null,
              insertedEvents: 0,
              kind: it.kind,
              error: err?.message ?? 'Error reconciliando',
            } as ApplyOutcome;
          }
        }),
      ),
    );
  }

  /**
   * Reúne los rastreables (normales + F2) de una ruta por pertenencia HISTÓRICA
   * (package_dispatch_history), no el FK vivo: un paquete pudo reasignarse a otra ruta
   * después. Dedup por (tipo, id).
   */
  private async gatherRouteItems(routeId: string): Promise<CompareItem[]> {
    const history = await this.dispatchHistoryRepo.find({
      where: { dispatch: { id: routeId } },
      relations: ['shipment', 'shipment.subsidiary', 'chargeShipment', 'chargeShipment.subsidiary'],
    });
    const items: CompareItem[] = [];
    const seen = new Set<string>();
    for (const h of history) {
      if (h.shipment && !seen.has(`s:${h.shipment.id}`)) {
        seen.add(`s:${h.shipment.id}`);
        items.push({ entity: h.shipment, kind: 'shipment' });
      }
      if (h.chargeShipment && !seen.has(`c:${h.chargeShipment.id}`)) {
        seen.add(`c:${h.chargeShipment.id}`);
        items.push({ entity: h.chargeShipment, kind: 'charge' });
      }
    }
    return items;
  }

  async compareByConsolidated(consolidatedId: string): Promise<CompareResult[]> {
    const [ships, charges] = await Promise.all([
      this.shipmentRepo.find({ where: { consolidatedId }, relations: ['subsidiary'] }),
      this.chargeRepo.find({ where: { consolidatedId }, relations: ['subsidiary'] }),
    ]);
    const items: CompareItem[] = [
      ...ships.map((e) => ({ entity: e as Trackable, kind: 'shipment' as TrackableKind })),
      ...charges.map((e) => ({ entity: e as Trackable, kind: 'charge' as TrackableKind })),
    ];
    return this.compareManyItems(items);
  }

  async applyMany(shipmentIds: string[], actor: ApplyActor): Promise<ApplyOutcome[]> {
    const ids = [...new Set((shipmentIds || []).filter(Boolean))];
    const limit = createLimit(6);
    return Promise.all(
      ids.map((id) =>
        limit(async () => {
          const resolved = await this.resolveById(id);
          if (!resolved) {
            return {
              shipmentId: id, trackingNumber: '', applied: false,
              fromStatus: ShipmentStatusType.DESCONOCIDO, toStatus: null, insertedEvents: 0,
              skippedReason: 'Guía no encontrada',
            };
          }
          const built = await this.buildContext(resolved.entity, resolved.kind);
          if (!built) {
            return {
              shipmentId: id, trackingNumber: resolved.entity.trackingNumber, applied: false,
              fromStatus: resolved.entity.status, toStatus: null, insertedEvents: 0,
              skippedReason: 'Sin datos FedEx',
            };
          }
          return this.persistentSink.applyPlan(built.ctx, actor);
        }),
      ),
    );
  }

  /** Compara un rastreable ya cargado (normal o F2). */
  async compareTrackable(entity: Trackable, kind: TrackableKind): Promise<CompareResult> {
    try {
      const built = await this.buildContext(entity, kind);
      if (!built) {
        return this.emptyResult(entity.trackingNumber, entity, kind, 'Sin datos en FedEx');
      }

      const { ctx, ourLastEventAt } = built;
      const fedexLastEventAt = ctx.normalized.latest ? ctx.normalized.latest.occurredAt.toISOString() : null;
      const diverges = ctx.proposedStatus != null && ctx.proposedStatus !== entity.status;
      const isStale = !!fedexLastEventAt && (ourLastEventAt == null || fedexLastEventAt > ourLastEventAt);

      return {
        shipmentId: entity.id,
        kind,
        trackingNumber: entity.trackingNumber,
        ourStatus: entity.status,
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
      this.logger.warn(`compareTrackable ${entity.trackingNumber}: ${err?.message}`);
      return this.emptyResult(entity.trackingNumber, entity, kind, err?.message ?? 'Error consultando FedEx');
    }
  }

  /**
   * Consulta FedEx, normaliza, reconcilia contra nuestro historial y corre las reglas.
   * Devuelve el contexto listo + la fecha de nuestro último evento. `null` si FedEx no dio datos.
   */
  private async buildContext(
    entity: Trackable,
    kind: TrackableKind,
  ): Promise<{ ctx: SyncContext; ourLastEventAt: string | null } | null> {
    const [raw] = await this.source.fetch([
      { trackingNumber: entity.trackingNumber, fedexUniqueId: entity.fedexUniqueId, carrierCode: entity.carrierCode },
    ]);
    if (!raw || raw.trackResults.length === 0) return null;

    const normalized = this.normalizer.normalize(raw);
    const rows = await this.statusRepo.find({
      where: kind === 'charge' ? { chargeShipment: { id: entity.id } } : { shipment: { id: entity.id } },
      select: ['timestamp', 'exceptionCode', 'status'],
    });
    const knownKeys = new Set(
      rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)),
    );
    const ourLastEventAt = rows.length
      ? new Date(Math.max(...rows.map((r) => new Date(r.timestamp).getTime()))).toISOString()
      : null;
    // Estado existente para reglas dependientes del pasado (Time Shield, 3×08).
    // lastOpTime EFECTIVO: el EN_RUTA de una salida a ruta RETROACTIVA se re-ancla a su día
    // operativo (routeDate) para que el Time Shield no lo blinde contra el estatus real de
    // FedEx de ese día (caso 383295956902). Solo motor nuevo; no toca legacy ni la escritura.
    const dispatches = await this.loadDispatchAnchors(entity.id, kind);
    const lastOpTime = computeEffectiveLastOpTime(rows, dispatches);
    let count08 = 0;
    for (const r of rows) if ((r.exceptionCode ?? '').trim() === '08') count08++;
    const existing = { lastOpTime, count08 };

    const reconcile = this.reconciler.reconcile(
      normalized, knownKeys, entity.status, (e: NormalizedEvent) => e.shadowKey,
    );

    const ctx: SyncContext = {
      shipment: entity,
      kind,
      normalized,
      reconcile,
      existing,
      proposedStatus: reconcile.proposedStatus,
      vetoedEventKeys: new Set<string>(),
      deferredEffects: [],
      notes: [],
    };
    await this.pipeline.run(ctx);

    return { ctx, ourLastEventAt };
  }

  /**
   * Anclas de las salidas a ruta de una guía (routeDate declarado + momento de captura), para
   * re-anclar el EN_RUTA de rutas retroactivas al día operativo. Pertenencia HISTÓRICA
   * (package_dispatch_history), igual que `gatherRouteItems`: cubre reasignaciones de ruta.
   */
  private async loadDispatchAnchors(id: string, kind: TrackableKind): Promise<DispatchAnchor[]> {
    const history = await this.dispatchHistoryRepo.find({
      where: kind === 'charge' ? { chargeShipment: { id } } : { shipment: { id } },
      relations: ['dispatch'],
    });
    return history
      .map((h) => h.dispatch)
      .filter((d) => !!d && !!d.routeDate && !!d.createdAt)
      .map((d) => ({ routeDate: d.routeDate, createdAt: d.createdAt }));
  }

  /** Resuelve un id a su entidad + tipo (busca en shipment y luego en charge_shipment). */
  private async resolveById(id: string): Promise<CompareItem | null> {
    const ship = await this.shipmentRepo.findOne({ where: { id }, relations: ['subsidiary'] });
    if (ship) return { entity: ship, kind: 'shipment' };
    const charge = await this.chargeRepo.findOne({ where: { id }, relations: ['subsidiary'] });
    if (charge) return { entity: charge, kind: 'charge' };
    return null;
  }

  private async compareManyItems(items: CompareItem[]): Promise<CompareResult[]> {
    const limit = createLimit(6);
    return Promise.all(items.map((it) => limit(() => this.compareTrackable(it.entity, it.kind))));
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

  private emptyResult(
    trackingNumber: string,
    entity: Trackable | null,
    kind: TrackableKind,
    error: string,
  ): CompareResult {
    return {
      shipmentId: entity?.id ?? '',
      kind,
      trackingNumber,
      ourStatus: entity?.status ?? ShipmentStatusType.DESCONOCIDO,
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
