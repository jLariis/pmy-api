import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ChargeShipment, Income, Shipment, ShipmentStatus } from 'src/entities';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { TrackingCompareService, CompareItem } from 'src/tracking-sync/tracking-compare.service';
import { ApplyActor } from 'src/tracking-sync/sinks/persistent-sync.sink';
import { RawTrackingResult, TrackableKind } from 'src/tracking-sync/tracking-sync.types';
import { buildShadowKey } from 'src/tracking-sync/event-key.util';
import { createLimit } from 'src/tracking-sync/concurrency.util';
import { diagnosePackage, DoctorInput, PackageDiagnosis } from './closure-doctor.util';
import { isResolvedFedexOutcome, resolveClosureStatus, routeDayOf } from 'src/tracking-sync/closure-stuck-resolver.util';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import {
  loadRouteWindowContext,
  RouteWindowContext,
  routeWindowKey,
} from 'src/package-dispatch/route-window.query';

export interface ClosureFixItem {
  shipmentId: string;
  kind: TrackableKind;
  fingerprint: string;
}

export type ClosureFixResultStatus = 'applied' | 'changed' | 'nothing' | 'error';

export interface ClosureFixResult {
  shipmentId: string;
  kind: TrackableKind;
  trackingNumber: string | null;
  status: ClosureFixResultStatus;
  message: string;
}

/**
 * "Paquetes con problema" del cierre de ruta (solo superadmin). Diagnostica contra FedEx todas
 * las guías de la salida (sin persistir) y aplica, por paquete y a petición, los arreglos que el
 * superadmin confirmó. Al aplicar se vuelve a diagnosticar: si el plan ya no coincide con la
 * huella que vio el usuario, no se toca nada ("changed").
 *
 * Es una corrección MANUAL: puede escribir sobre estatus finales (que el motor automático ya no
 * toca), pero nunca los degrada a otro estatus (eso lo decide `diagnosePackage`).
 */
@Injectable()
export class ClosureDoctorService {
  private readonly logger = new Logger(ClosureDoctorService.name);

  constructor(
    @InjectRepository(PackageDispatch)
    private readonly dispatchRepo: Repository<PackageDispatch>,
    private readonly dataSource: DataSource,
    private readonly compare: TrackingCompareService,
  ) {}

  async diagnoseRoute(packageDispatchId: string) {
    const dispatch = await this.loadDispatch(packageDispatchId);
    const items = await this.routeItems(dispatch);
    const windowCtx = await loadRouteWindowContext(this.dataSource, dispatch.id);
    // FedEx en lotes de 30 (no una llamada por guía): evita 429 y acelera rutas grandes.
    let raw = new Map<string, RawTrackingResult>();
    try {
      raw = await this.compare.prefetchRaw(items.map((it) => it.entity));
    } catch (err: any) {
      this.logger.warn(`🩺 [Cierre] Precarga FedEx falló (${err?.message}); se consulta guía por guía.`);
    }
    const limit = createLimit(6);
    const all = await Promise.all(
      items.map((it) => limit(() => this.diagnoseItem(it, dispatch, windowCtx, raw.get(it.entity.trackingNumber)))),
    );
    const packages = all.filter((d) => d.problems.length > 0);
    this.logger.log(
      `🩺 [Cierre] Diagnóstico de ${packageDispatchId}: ${packages.length}/${items.length} paquetes con problema.`,
    );
    const anchor = dispatch.routeDate ?? dispatch.createdAt;
    return {
      packageDispatchId,
      is315: !!dispatch.is315,
      routeDay: routeDayOf(anchor ?? null),
      subsidiaryName: dispatch.subsidiary?.name ?? null,
      total: items.length,
      packages,
      /** Guías que el cierre hoy vería sin resultado (en ruta, pendiente…). */
      withoutOutcome: all.filter((d) => !isResolvedFedexOutcome(d.closureStatus)).map((d) => d.trackingNumber),
    };
  }

  async applyFixes(packageDispatchId: string, fixes: ClosureFixItem[], actor: ApplyActor) {
    const dispatch = await this.loadDispatch(packageDispatchId);
    const byKey = new Map((await this.routeItems(dispatch)).map((it) => [`${it.kind}:${it.entity.id}`, it]));
    const windowCtx = await loadRouteWindowContext(this.dataSource, dispatch.id);
    const results: ClosureFixResult[] = [];

    // Secuencial: son pocos y así cada paquete ve lo que escribió el anterior (misma guía repetida).
    for (const fix of fixes) {
      const it = byKey.get(`${fix.kind}:${fix.shipmentId}`);
      if (!it) {
        results.push({ ...this.base(fix, null), status: 'error', message: 'El paquete no pertenece a esta salida.' });
        continue;
      }
      try {
        const diagnosis = await this.diagnoseItem(it, dispatch, windowCtx);
        if (!diagnosis.plan) {
          results.push({ ...this.base(fix, it), status: 'nothing', message: 'Ya no hay nada que corregir.' });
          continue;
        }
        if (diagnosis.fingerprint !== fix.fingerprint) {
          results.push({
            ...this.base(fix, it),
            status: 'changed',
            message: 'La información cambió desde que la revisaste. Vuelve a revisar este paquete.',
          });
          continue;
        }
        await this.applyPlan(it, diagnosis, dispatch, actor);
        this.logger.warn(
          `🩺 [Cierre] ${actor.userName ?? actor.userId} aplicó arreglo a ${it.entity.trackingNumber} ` +
            `(${diagnosis.problems.join(',')}) en salida ${packageDispatchId}.`,
        );
        results.push({ ...this.base(fix, it), status: 'applied', message: 'Arreglo aplicado.' });
      } catch (err: any) {
        this.logger.error(`🩺 [Cierre] Error aplicando arreglo a ${it.entity.trackingNumber}: ${err?.message}`);
        results.push({ ...this.base(fix, it), status: 'error', message: 'No se pudo aplicar el arreglo. Intenta de nuevo.' });
      }
    }
    return { packageDispatchId, results };
  }

  private base(fix: ClosureFixItem, it: CompareItem | null) {
    return { shipmentId: fix.shipmentId, kind: fix.kind, trackingNumber: it?.entity.trackingNumber ?? null };
  }

  private async loadDispatch(id: string): Promise<PackageDispatch> {
    const dispatch = await this.dispatchRepo.findOne({ where: { id }, relations: ['subsidiary'] });
    if (!dispatch) throw new BadRequestException('La salida a ruta no existe.');
    return dispatch;
  }

  /** Rutas 31.5 solo revisan cargas (igual que la reconciliación al abrir). Sin guías dadas de baja. */
  private async routeItems(dispatch: PackageDispatch): Promise<CompareItem[]> {
    const kinds: TrackableKind[] = dispatch.is315 ? ['charge'] : ['shipment', 'charge'];
    const items = await this.compare.listRouteItems(dispatch.id, kinds);
    return items.filter((it) => (it.entity as any)?.active !== false);
  }

  private async diagnoseItem(
    it: CompareItem,
    dispatch: PackageDispatch,
    windowCtx: RouteWindowContext,
    prefetched?: RawTrackingResult,
  ): Promise<PackageDiagnosis> {
    const { entity, kind } = it;
    let fedex: DoctorInput['fedex'] = null;
    let fedexError: string | null = null;
    try {
      const snap = await this.compare.buildDoctorSnapshot(entity, kind, prefetched);
      if (snap) {
        fedex = {
          events: snap.events.map((e) => ({
            occurredAt: e.occurredAt,
            status: e.status,
            exceptionCode: e.exceptionCode,
            description: e.description,
            location: e.location,
            shadowKey: e.shadowKey,
            vetoed: snap.vetoedEventKeys.has(e.eventKey),
          })),
          shieldedStatus: snap.shieldedStatus,
          rawStatus: snap.rawStatus,
          headerDeliveredAt: snap.headerDeliveredAt,
        };
      }
    } catch (err: any) {
      fedexError = err?.message ?? 'error consultando FedEx';
    }

    const rows = await this.dataSource.getRepository(ShipmentStatus).find({
      where: kind === 'charge' ? { chargeShipment: { id: entity.id } } : { shipment: { id: entity.id } },
      select: ['timestamp', 'exceptionCode', 'status'],
    });

    // Cómo ve HOY el cierre esta guía: misma regla que la vista del cierre (resolveClosureStatus).
    const key = routeWindowKey(kind, entity.id);
    const nextDispatchAt = windowCtx.nextDispatchAt.get(key) ?? null;
    const closureNow = resolveClosureStatus({
      history: rows.map((r) => ({ status: r.status, timestamp: r.timestamp, exceptionCode: r.exceptionCode })),
      routeAnchor: dispatch.routeDate ?? dispatch.createdAt ?? null,
      liveStatus: entity.status,
      untilNextDispatch: !!dispatch.subsidiary?.closureUntilNextDispatch,
      nextDispatchAt,
      acceptAnyDayDelivery: !!dispatch.subsidiary?.closureAcceptsAnyDayDelivery,
      override: windowCtx.overrides.get(key) ?? null,
    });

    const incomes =
      kind === 'shipment'
        ? await this.dataSource.getRepository(Income).find({
            where: { trackingNumber: entity.trackingNumber, sourceType: IncomeSourceType.SHIPMENT, active: true },
            select: ['id', 'incomeType', 'date'],
          })
        : [];

    return diagnosePackage({
      entity: { id: entity.id, trackingNumber: entity.trackingNumber, kind, status: entity.status },
      fedex,
      fedexError,
      historyRows: rows.map((r) => ({
        status: r.status,
        exceptionCode: r.exceptionCode ?? null,
        timestamp: new Date(r.timestamp),
        shadowKey: buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status),
      })),
      incomes: incomes.map((i) => ({ id: i.id, incomeType: i.incomeType, date: new Date(i.date) })),
      dispatch: {
        routeDate: dispatch.routeDate ?? null,
        createdAt: dispatch.createdAt ?? null,
        is315: !!dispatch.is315,
        cost: Number(dispatch.subsidiary?.fedexCostPackage ?? 0),
      },
      closure: { status: closureNow?.status ?? null, nextDispatchAt },
    });
  }

  /** Aplica el plan de UN paquete en una sola transacción. */
  private async applyPlan(it: CompareItem, d: PackageDiagnosis, dispatch: PackageDispatch, actor: ApplyActor) {
    const plan = d.plan!;
    const isCharge = it.kind === 'charge';
    await this.dataSource.transaction(async (m) => {
      if (plan.insertEvents.length) {
        const rows = await m.find(ShipmentStatus, {
          where: isCharge ? { chargeShipment: { id: it.entity.id } } : { shipment: { id: it.entity.id } },
          select: ['timestamp', 'exceptionCode', 'status'],
        });
        const known = new Set(
          rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)),
        );
        for (const e of plan.insertEvents) {
          const at = new Date(e.occurredAt);
          if (known.has(buildShadowKey(at.getTime(), e.exceptionCode, e.status))) continue;
          await m.save(
            ShipmentStatus,
            m.create(ShipmentStatus, {
              status: e.status,
              exceptionCode: e.exceptionCode ?? '',
              timestamp: at,
              notes: `${e.description ?? 'FedEx'} (corrección en cierre por superadmin)`,
              ...(isCharge ? { chargeShipment: { id: it.entity.id } as ChargeShipment } : { shipment: { id: it.entity.id } as Shipment }),
            }),
          );
        }
      }

      if (plan.closure) {
        await m.update(
          PackageDispatchHistory,
          isCharge
            ? { dispatch: { id: dispatch.id }, chargeShipment: { id: it.entity.id } }
            : { dispatch: { id: dispatch.id }, shipment: { id: it.entity.id } },
          {
            closureStatus: plan.closure.status,
            closureExceptionCode: plan.closure.exceptionCode,
            closureStatusAt: new Date(plan.closure.occurredAt),
            closureFixedById: actor.userId ?? null,
            closureFixedAt: new Date(),
          },
        );
      }

      if (plan.setStatus) {
        await m.update(isCharge ? ChargeShipment : Shipment, { id: it.entity.id }, { status: plan.setStatus });
      }

      if (plan.income && !isCharge && !dispatch.is315) {
        const inc = plan.income;
        if (inc.type === 'create') {
          await m.save(
            Income,
            m.create(Income, {
              trackingNumber: it.entity.trackingNumber,
              subsidiary: dispatch.subsidiary,
              shipmentType: ShipmentType.FEDEX,
              cost: inc.cost,
              incomeType: inc.incomeType,
              nonDeliveryStatus: inc.nonDeliveryStatus,
              isGrouped: false,
              sourceType: IncomeSourceType.SHIPMENT,
              shipment: { id: it.entity.id } as Shipment,
              date: new Date(inc.date),
              createdById: actor.userId ?? null,
            }),
          );
        } else if (inc.incomeId) {
          await m.update(Income, { id: inc.incomeId }, {
            incomeType: IncomeStatus.ENTREGADO,
            nonDeliveryStatus: null,
            date: new Date(inc.date),
          });
        }
      }
    });
  }
}
