import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Shipment } from '../../entities/shipment.entity';
import { Income } from '../../entities/income.entity';
import { Consolidated } from '../../entities/consolidated.entity';
import { PackageDispatch } from '../../entities/package-dispatch.entity';
import { FedexStatusResolver } from '../../fedex-status/fedex-status.resolver';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { ShipmentType } from '../../common/enums/shipment-type.enum';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { deriveStatusCorrection } from '../logic/status-correction.util';
import { deriveRepairIncome, planRepairIncome } from '../logic/repair-income.util';
import { detectAnomalies } from '../logic/detect-anomalies.util';
import { computeVerdict, Verdict } from '../logic/package-verdict.util';
import { statusOrigin } from '../logic/status-origin.util';
import { mapIncomeToRow } from '../read/consolidador-row.mapper';
import { ConsolidadorRow } from '../consolidador.types';
import { ConsolidadorAuditService } from '../audit/consolidador-audit.service';
import { shipmentIncomeWhere } from '../../common/shipment-income-where.util';

@Injectable()
export class ConsolidadorStatusService {
  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    private readonly resolver: FedexStatusResolver,
    private readonly audit: ConsolidadorAuditService,
  ) {}

  /**
   * Timeline unificado del paquete: recibido → consolidado → salidas a ruta (y sus cierres) →
   * estatus (con código) → ingreso. Ascendente por fecha. Cada evento trae `kind` para pintarlo
   * distinto en el FE. Sirve para envíos y cargas (F2/31.5); `ref` fija el registro exacto
   * (una guía puede tener varios registros); sin `ref` toma el registro más reciente.
   */
  async packageTimeline(tracking: string, ref?: { id: string; isCharge: boolean }) {
    const q = (sql: string, p: any[] = []) => this.shipmentRepo.manager.query(sql, p);
    let rec: any;
    if (ref?.id) {
      [rec] = await q(
        ref.isCharge
          ? 'SELECT id, 1 isCharge, status, createdAt, consolidatedId FROM charge_shipment WHERE id = ?'
          : 'SELECT id, 0 isCharge, status, createdAt, consolidatedId FROM shipment WHERE id = ?',
        [ref.id],
      );
    } else {
      [rec] = await q(
        `SELECT * FROM (
           SELECT id, 0 isCharge, status, createdAt, consolidatedId FROM shipment WHERE trackingNumber = ? AND active = 1
           UNION ALL SELECT id, 1, status, createdAt, consolidatedId FROM charge_shipment WHERE trackingNumber = ? AND active = 1
         ) x ORDER BY createdAt DESC LIMIT 1`,
        [tracking, tracking],
      );
    }
    if (!rec) return { events: [] as any[] };
    const isCharge = !!Number(rec.isCharge);
    const col = isCharge ? 'chargeShipmentId' : 'shipmentId';

    const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
    // `granularity` distingue INSTANTE (fecha+hora reales, p.ej. createdAt/evento FedEx) de
    // DÍA de negocio guardado como medianoche UTC (consolidado, carga). El FE pinta los 'day'
    // como fecha por su día UTC (sin hora ni desplazar a Hermosillo), evitando que un día-solo
    // 00:00Z se corra 7h al día anterior con una hora falsa.
    type Granularity = 'instant' | 'day';
    const events: Array<{ kind: string; label: string; date: string | null; granularity: Granularity; meta?: any }> = [];

    if (rec.createdAt)
      events.push({ kind: 'recibido', label: isCharge ? 'Registrada como carga' : 'Registrado en el sistema', date: iso(rec.createdAt), granularity: 'instant' });

    if (rec.consolidatedId) {
      const cons = await this.shipmentRepo.manager.getRepository(Consolidated).findOne({ where: { id: rec.consolidatedId } });
      if (cons) {
        events.push({
          kind: 'consolidado',
          label: cons.consNumber ? `Consolidado ${cons.consNumber}` : 'Consolidado',
          date: iso(cons.date ?? cons.createdAt),
          granularity: 'day', // consolidated.date = día de negocio (00:00Z)
        });
      }
    }

    // Todas las salidas a ruta en que fue (historial, no solo la relación viva) y su cierre.
    const routes: any[] = await q(
      `SELECT pd.trackingNumber folio, pd.createdAt departedAt, MAX(rc.createdAt) closedAt
         FROM package_dispatch_history h JOIN package_dispatch pd ON pd.id = h.dispatchId
         LEFT JOIN route_closure rc ON rc.package_dispatch_id = pd.id
        WHERE h.${col} = ? GROUP BY pd.id, pd.trackingNumber, pd.createdAt`,
      [rec.id],
    );
    for (const r of routes) {
      events.push({ kind: 'salida_ruta', label: `Salió a ruta ${r.folio ?? ''}`.trim(), date: iso(r.departedAt), granularity: 'instant' });
      if (r.closedAt) events.push({ kind: 'salida_ruta', label: `Se cerró la ruta ${r.folio ?? ''}`.trim(), date: iso(r.closedAt), granularity: 'instant' });
    }

    const history: any[] = await q(
      `SELECT status, NULLIF(exceptionCode, '') exceptionCode, timestamp FROM shipment_status WHERE ${col} = ?`,
      [rec.id],
    );
    for (const s of history) {
      const origin = statusOrigin(s.status);
      const code = s.exceptionCode && !['44', '67'].includes(String(s.exceptionCode)) ? ` · ${s.exceptionCode}` : '';
      events.push({
        kind: origin === 'fedex' ? 'estatus_fedex' : 'estatus_interno',
        label: `${String(s.status ?? '').replace(/_/g, ' ')}${code}`,
        date: iso(s.timestamp),
        granularity: 'instant', // timestamp real del evento
      });
    }

    if (!isCharge) {
      const income = await this.incomeRepo.findOne({
        where: { shipment: { id: rec.id }, active: true },
        relations: ['subsidiary'],
      });
      if (income) {
        // Ingreso de carga (grouped) usa el día del consolidado; el de envío ancla al evento.
        const isChargeIncome = income.sourceType === IncomeSourceType.CHARGE;
        events.push({
          kind: 'ingreso',
          label: `Ingreso (${income.incomeType})`,
          date: iso(income.date),
          granularity: isChargeIncome ? 'day' : 'instant',
          meta: { cost: Number(income.cost), subsidiary: (income.subsidiary as any)?.name ?? null },
        });
      }
    }

    events.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());
    // Compacto: el mismo estatus repetido seguido (el cron lo reescribe en cada consulta) se
    // muestra una vez, con la fecha de la primera.
    const compact = events.filter((ev, i) => {
      if (!ev.kind.startsWith('estatus_')) return true;
      const prev = events.slice(0, i).reverse().find((x) => x.kind.startsWith('estatus_'));
      return !prev || prev.label !== ev.label;
    });
    return { tracking, currentStatus: rec.status, events: compact };
  }

  /** Historial de estatus del shipment (status + timestamp), más reciente primero. */
  private statusHistoryOf(shipment: Shipment | null): Array<{ status: string; timestamp: string | null }> {
    const hist = (shipment as any)?.statusHistory as Array<{ status?: string; timestamp?: Date }> | undefined;
    if (!hist?.length) return [];
    return hist
      .map((s) => ({ status: String(s.status ?? ''), timestamp: s.timestamp ? new Date(s.timestamp).toISOString() : null }))
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());
  }

  /** Fecha del último evento de estatus (shipment_status.timestamp) — fecha "del cobro" por estatus. */
  private latestStatusDate(shipment: Shipment | null): string | null {
    const hist = (shipment as any)?.statusHistory as Array<{ timestamp?: Date }> | undefined;
    if (!hist?.length) return null;
    const max = hist.reduce<Date | null>((acc, s) => {
      const t = s.timestamp ? new Date(s.timestamp) : null;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    return max ? max.toISOString() : null;
  }

  /** routeDate de la salida a ruta del shipment (día de negocio), o null si no salió a ruta. */
  private async routeDateOf(shipment: Shipment | null): Promise<Date | null> {
    const routeId = (shipment as any)?.routeId;
    if (!routeId) return null;
    const pd = await this.shipmentRepo.manager
      .getRepository(PackageDispatch)
      .findOne({ where: { id: routeId } });
    return (pd as any)?.routeDate ?? (pd as any)?.createdAt ?? null;
  }

  /** Compone el veredicto del paquete cruzando estatus + consolidado + ruta + fecha del ingreso. */
  private buildVerdict(
    shipment: Shipment | null,
    income: Income | null,
    routeDate: Date | null,
    fedexVerified: boolean,
  ): Verdict {
    return computeVerdict({
      currentStatus: shipment?.status ?? null,
      history: (shipment as any)?.statusHistory ?? [],
      hasConsolidado: !!(shipment as any)?.consolidatedId,
      routeDate,
      incomeDate: income?.date ?? null,
      fedexVerified,
    });
  }

  /** Busca un paquete y compone estatus interno vs FedEx canónico + income ligado (activo). */
  async search(tracking: string) {
    const shipment = await this.shipmentRepo.findOne({ where: { trackingNumber: tracking }, relations: ['statusHistory'] });
    const fedex = await this.resolver.getLatestStatus(tracking);
    const income = shipment
      ? await this.incomeRepo.findOne({
          where: { shipment: { id: shipment.id }, active: true },
          relations: ['shipment', 'charge', 'subsidiary'],
        })
      : null;
    const suggestion = shipment ? deriveStatusCorrection(shipment.status, fedex.status) : null;
    // ¿Se puede reparar el ingreso? Solo si hay shipment, NO tiene ingreso activo y su estatus es cobrable.
    const repair = shipment && !income ? deriveRepairIncome(shipment.status) : { create: false, incomeType: null };
    const routeDate = await this.routeDateOf(shipment);
    return {
      shipment: shipment ? { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
      internalStatus: shipment?.status ?? null,
      fedex,
      suggestion,
      income: income ? mapIncomeToRow(income) : null,
      incomeRepairNeeded: repair.create,
      incomeRepairType: repair.incomeType,
      statusDate: this.latestStatusDate(shipment),
      incomeDate: income ? (income.date instanceof Date ? income.date.toISOString() : new Date(income.date).toISOString()) : null,
      anomalies: detectAnomalies({
        currentStatus: shipment?.status ?? null,
        history: (shipment as any)?.statusHistory ?? [],
        income: income ? { date: income.date } : null,
        statusDate: this.latestStatusDate(shipment),
      }),
      verdict: this.buildVerdict(shipment, income, routeDate, !!fedex.found && !fedex.error),
      statusHistory: this.statusHistoryOf(shipment),
    };
  }

  /** Búsqueda por lote (hasta 30 guías). Usa el batch de FedEx y arma un resultado por guía. */
  async searchBatch(trackings: string[]) {
    const unique = [...new Set((trackings || []).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
    if (unique.length === 0) return { results: [] };

    const [shipments, fedexList] = await Promise.all([
      this.shipmentRepo.find({ where: { trackingNumber: In(unique) }, relations: ['statusHistory'] }),
      this.resolver.getLatestStatusBatch(unique),
    ]);
    const shipmentByTn = new Map(shipments.map((s) => [s.trackingNumber, s]));
    const fedexByTn = new Map(fedexList.map((f) => [f.trackingNumber, f]));

    const shipmentIds = shipments.map((s) => s.id);
    const incomes = shipmentIds.length
      ? await this.incomeRepo.find({ where: { shipment: { id: In(shipmentIds) }, active: true }, relations: ['shipment', 'charge', 'subsidiary'] })
      : [];
    const incomeByShipmentId = new Map(incomes.map((i) => [i.shipment?.id, i]));

    // Precarga las salidas a ruta (routeDate) de todas las guías en un solo query.
    const routeIds = [...new Set(shipments.map((s) => (s as any).routeId).filter(Boolean))];
    const dispatches = routeIds.length
      ? await this.shipmentRepo.manager.getRepository(PackageDispatch).find({ where: { id: In(routeIds) } })
      : [];
    const routeDateById = new Map<string, Date | null>(
      dispatches.map((pd) => [pd.id, ((pd as any).routeDate ?? (pd as any).createdAt ?? null) as Date | null]),
    );

    const results = unique.map((tn) => {
      const shipment = shipmentByTn.get(tn) ?? null;
      // getLatestStatusBatch devuelve una entrada por guía; el fallback es defensivo.
      const fedex = fedexByTn.get(tn) ?? { trackingNumber: tn, found: false, status: null, error: 'Sin datos' };
      const suggestion = shipment ? deriveStatusCorrection(shipment.status, fedex.status ?? null) : null;
      const income = shipment ? incomeByShipmentId.get(shipment.id) : null;
      const repair = shipment && !income ? deriveRepairIncome(shipment.status) : { create: false, incomeType: null };
      return {
        tracking: tn,
        shipment: shipment ? { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
        internalStatus: shipment?.status ?? null,
        fedex,
        suggestion,
        income: income ? mapIncomeToRow(income) : null,
        incomeRepairNeeded: repair.create,
        incomeRepairType: repair.incomeType,
        statusDate: this.latestStatusDate(shipment),
        incomeDate: income ? (income.date instanceof Date ? income.date.toISOString() : new Date(income.date).toISOString()) : null,
        anomalies: detectAnomalies({
          currentStatus: shipment?.status ?? null,
          history: (shipment as any)?.statusHistory ?? [],
          income: income ? { date: income.date } : null,
          statusDate: this.latestStatusDate(shipment),
        }),
        verdict: this.buildVerdict(
          shipment,
          income ?? null,
          (shipment && (shipment as any).routeId ? routeDateById.get((shipment as any).routeId) : null) ?? null,
          !!fedex.found && !fedex.error,
        ),
        statusHistory: this.statusHistoryOf(shipment),
      };
    });
    return { results };
  }

  /** Corrige `shipment.status` (verificado contra FedEx) y ajusta el income ligado. */
  async fixStatus(
    shipmentId: string,
    newStatus: ShipmentStatusType,
    reason: string,
    userId: string,
  ): Promise<{ shipmentStatus: ShipmentStatusType; income: ConsolidadorRow | null }> {
    const shipment = await this.shipmentRepo.findOne({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Shipment no encontrado');

    // Verificación contra FedEx: no se corrige si FedEx no confirma.
    const fedex = await this.resolver.getLatestStatus(shipment.trackingNumber);
    if (!fedex.found || fedex.error) {
      throw new BadRequestException('No se pudo verificar el estatus contra FedEx');
    }

    const { newStatus: resolved, incomeEffect } = deriveStatusCorrection(shipment.status, fedex.status);
    if (!resolved || resolved !== newStatus) {
      throw new BadRequestException('El estatus solicitado no coincide con lo que reporta FedEx');
    }

    const oldStatus = shipment.status;
    shipment.status = resolved; // escribe SHIPMENT
    await this.shipmentRepo.save(shipment);

    // Ajusta el income ligado según el efecto acotado.
    const income = await this.incomeRepo.findOne({
      where: { shipment: { id: shipment.id } },
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    let oldIncomeType: string | null = null;
    if (income && incomeEffect.kind === 'reclassify') {
      oldIncomeType = income.incomeType;
      income.incomeType = incomeEffect.incomeType;
      income.updatedById = userId;
      income.updatedAt = new Date();
      income.editReason = reason;
      await this.incomeRepo.save(income);
    }

    await this.audit.record({
      incomeId: income?.id ?? null,
      shipmentId: shipment.id,
      action: 'status_fix',
      field: 'shipment.status',
      oldValue: oldStatus,
      newValue: resolved,
      reason,
      userId,
    });
    if (income && incomeEffect.kind === 'reclassify') {
      await this.audit.record({
        incomeId: income.id,
        shipmentId: shipment.id,
        action: 'status_fix',
        field: 'income.incomeType',
        oldValue: oldIncomeType,
        newValue: incomeEffect.incomeType,
        reason,
        userId,
      });
    }

    return { shipmentStatus: shipment.status, income: income ? mapIncomeToRow(income) : null };
  }

  /**
   * Repara el ingreso de un paquete: si NO tiene ingreso activo y su estatus es cobrable, crea uno
   * (sourceType=shipment, costo=subsidiary.fedexCostPackage, tipo según el estatus). Solo toca `income`.
   */
  async repairIncome(
    shipmentId: string,
    reason: string,
    userId: string,
  ): Promise<{ created: boolean; reason?: string; income: ConsolidadorRow | null }> {
    const shipment = await this.shipmentRepo.findOne({ where: { id: shipmentId }, relations: ['subsidiary'] });
    if (!shipment) throw new NotFoundException('Shipment no encontrado');

    // Ingresos activos de ESTE paquete (no de otros registros de la guía) + entrega en bodega
    // (si la hubo): misma regla que pick-up.
    const existingActive = await this.incomeRepo.find({
      where: shipmentIncomeWhere(shipment.id, shipment.trackingNumber, { sourceType: IncomeSourceType.SHIPMENT }),
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    // Cuándo pasó: último evento del historial con el estatus actual, y el día de su última ruta.
    const ev = await this.incomeRepo.manager.query(
      `SELECT timestamp FROM shipment_status WHERE shipmentId = ? AND status = ? ORDER BY timestamp DESC LIMIT 1`,
      [shipment.id, shipment.status],
    );
    const rt = await this.incomeRepo.manager.query(
      `SELECT DATE_FORMAT(pd.routeDate, '%Y-%m-%d') AS routeDay FROM package_dispatch_history h JOIN package_dispatch pd ON pd.id = h.dispatchId
        WHERE h.shipmentId = ? AND pd.routeDate IS NOT NULL ORDER BY pd.routeDate DESC LIMIT 1`,
      [shipment.id],
    );
    const wd = await this.incomeRepo.manager.query(
      `SELECT date FROM warehouse_delivery WHERE shipmentId = ? OR trackingNumber = ? ORDER BY date DESC LIMIT 1`,
      [shipment.id, shipment.trackingNumber],
    );
    const plan = planRepairIncome({
      status: shipment.status,
      warehouseDeliveredAt: wd?.[0]?.date ? new Date(wd[0].date) : null,
      existingActive: existingActive.map((i) => ({ id: i.id, incomeType: i.incomeType })),
      shipmentType: shipment.shipmentType,
      subsidiary: shipment.subsidiary as any,
      statusEventAt: ev?.[0]?.timestamp ? new Date(ev[0].timestamp) : null,
      routeDate: rt?.[0]?.routeDay ? new Date(`${rt[0].routeDay}T07:00:00Z`) : null,
    });

    if (plan.action === 'none') {
      const current = existingActive[0];
      return { created: false, reason: plan.reason, income: current ? mapIncomeToRow(current) : null };
    }

    if (plan.action === 'supersede') {
      // Entregado en bodega reemplaza el DEX de una visita previa (no se duplica el cobro).
      const dex = existingActive.find((i) => i.id === plan.incomeId)!;
      const before = { incomeType: dex.incomeType, nonDeliveryStatus: dex.nonDeliveryStatus, date: dex.date };
      await this.incomeRepo.update(dex.id, {
        incomeType: plan.incomeType!,
        nonDeliveryStatus: null,
        date: plan.date!,
        editReason: reason,
        updatedById: userId,
      } as any);
      await this.audit.record({
        incomeId: dex.id,
        shipmentId,
        action: 'income_repair',
        field: 'incomeType',
        oldValue: `${before.incomeType}${before.nonDeliveryStatus ? ` ${before.nonDeliveryStatus}` : ''}`,
        newValue: String(plan.incomeType),
        reason,
        userId,
      });
      const updated = await this.incomeRepo.findOne({ where: { id: dex.id }, relations: ['shipment', 'charge', 'subsidiary'] });
      return { created: true, income: updated ? mapIncomeToRow(updated) : null };
    }

    const income = this.incomeRepo.create({
      subsidiary: shipment.subsidiary,
      trackingNumber: shipment.trackingNumber,
      shipmentType: shipment.shipmentType ?? ShipmentType.FEDEX,
      incomeType: plan.incomeType!,
      cost: plan.cost,
      isGrouped: false,
      sourceType: IncomeSourceType.SHIPMENT,
      shipment: { id: shipment.id } as any,
      date: plan.date ?? new Date(),
      createdById: userId,
      editReason: reason,
    });
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId,
      action: 'income_repair',
      field: 'create',
      oldValue: null,
      newValue: plan.cost,
      reason,
      userId,
    });
    return { created: true, income: mapIncomeToRow(income) };
  }
}
