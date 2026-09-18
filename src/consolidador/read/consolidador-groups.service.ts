import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { Shipment } from '../../entities/shipment.entity';
import { PackageDispatch } from '../../entities/package-dispatch.entity';
import { PackageDispatchHistory } from '../../entities/package-dispatch-history.entity';
import { Consolidated } from '../../entities/consolidated.entity';
import { Subsidiary } from '../../entities/subsidiary.entity';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { CobrosAuditService } from '../audit/cobros-audit.service';
import { computeVerdict, Verdict } from '../logic/package-verdict.util';
import { buildGroups } from '../logic/consolidador-groups.util';
import { mapIncomeToRow } from './consolidador-row.mapper';
import { ChargeIssue, ConsolidadorGroupsResult, ConsolidadorRow, GroupInputRow } from '../consolidador.types';

const NEUTRAL_OK: Verdict = { code: 'no_income_ok', level: 'ok', title: '', evidence: [], suggestedAction: { kind: 'none' } };

/**
 * Lectura agregada del Consolidador POR RUTA o POR CONSOLIDADO.
 * IMPORTANTE (v2.1): se ancla a las ENTIDADES de la semana, no a la fecha del ingreso:
 *  - por ruta: las salidas a ruta cuya `routeDate` (la fecha que le pusieron a la ruta, NO createdAt)
 *    cae en la semana; de ahí se sacan sus envíos e ingresos → "cuánto se gana por ruta" ese día.
 *  - por consolidado: los consolidados cuya `date` cae en la semana.
 * Cada fila trae la fila de ingreso completa (para editar/historial) + veredicto. Read-only aquí;
 * las mutaciones (editar/arreglar/borrar) reusan los endpoints existentes.
 */
@Injectable()
export class ConsolidadorGroupsService {
  constructor(
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    private readonly cobrosAudit: CobrosAuditService,
  ) {}

  // ---- POR RUTA: rutas de la semana (routeDate) → paquetes vía package_dispatch_history ----
  async getByRoute(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult> {
    // 1) Todas las rutas de la semana de la sucursal, por su fecha de ruta (no createdAt).
    const routes = await this.incomeRepo.manager
      .getRepository(PackageDispatch)
      .createQueryBuilder('pd')
      .leftJoinAndSelect('pd.drivers', 'd')
      .where('pd.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('pd.routeDate BETWEEN :from AND :to', { from, to })
      .getMany();

    const routeMeta = new Map<string, { date: Date | null; number: string | null; driver: string | null }>();
    for (const pd of routes) {
      const driver = ((pd as any).drivers ?? []).map((x: any) => x?.name).filter(Boolean).join(', ') || null;
      routeMeta.set(pd.id, { date: (pd as any).routeDate ?? null, number: (pd as any).trackingNumber ?? null, driver });
    }
    const routeIds = [...routeMeta.keys()];
    if (routeIds.length === 0) return { groups: [] };

    // 2) Los paquetes de cada ruta salen del HISTORIAL (dispatchId → shipmentId), no de shipment.routeId.
    const histRows = await this.incomeRepo.manager
      .getRepository(PackageDispatchHistory)
      .createQueryBuilder('h')
      .select('h.dispatchId', 'dispatchId')
      .addSelect('h.shipmentId', 'shipmentId')
      .where('h.dispatchId IN (:...routeIds)', { routeIds })
      .andWhere('h.shipmentId IS NOT NULL')
      .getRawMany<{ dispatchId: string; shipmentId: string }>();

    const shipmentIdsByRoute = new Map<string, Set<string>>();
    const allShipmentIds = new Set<string>();
    for (const r of histRows) {
      if (!routeMeta.has(r.dispatchId)) continue;
      if (!shipmentIdsByRoute.has(r.dispatchId)) shipmentIdsByRoute.set(r.dispatchId, new Set());
      shipmentIdsByRoute.get(r.dispatchId)!.add(r.shipmentId);
      allShipmentIds.add(r.shipmentId);
    }
    if (allShipmentIds.size === 0) return { groups: [] };

    // 3) Carga los envíos y mapea sus ingresos por shipmentId.
    const shipments = await this.loadShipmentsByIds([...allShipmentIds]);
    const shipmentById = new Map(shipments.map((s) => [s.id, s]));
    const incomeByShipment = await this.incomesByShipment([...allShipmentIds]);
    const discrepancy = await this.discrepancyByTracking(subsidiaryId, from, to);

    const rows: GroupInputRow[] = [];
    for (const [routeId, sids] of shipmentIdsByRoute) {
      const meta = routeMeta.get(routeId)!;
      const label = `Ruta ${meta.number ?? `…${routeId.slice(-6)}`}`;
      for (const sid of sids) {
        const s = shipmentById.get(sid);
        if (!s) continue;
        rows.push(this.shipmentRow(s, incomeByShipment.get(sid) ?? null, routeId, label, meta.date, meta.driver, meta.date));
      }
    }

    return buildGroups(rows, discrepancy);
  }

  // ---- POR CONSOLIDADO: consolidados de la semana (date) ----
  async getByConsolidado(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult> {
    const consolidados = await this.incomeRepo.manager
      .getRepository(Consolidated)
      .find({ where: { date: Between(from, to) } });
    // Agrupamos por el consolidado (id) — así ningún paquete cae en "Sin consolidado".
    const consMetaById = new Map<string, { label: string; date: Date | null; consNumber: string | null }>();
    const consByNumber = new Map<string, Date | null>(); // para cruzar cargas por consNumber
    for (const c of consolidados) {
      consMetaById.set(c.id, {
        label: c.consNumber ? `Consolidado ${c.consNumber}` : `Consolidado …${String(c.id).slice(-6)}`,
        date: c.date ?? null,
        consNumber: c.consNumber ?? null,
      });
      if (c.consNumber) consByNumber.set(c.consNumber, c.date ?? null);
    }
    const consIds = [...consMetaById.keys()];
    if (consIds.length === 0) return { groups: [] };

    // Envíos de la sucursal en esos consolidados.
    const shipments = await this.loadShipments('consolidatedId', consIds, subsidiaryId);
    const incomeByShipment = await this.incomesByShipment(shipments.map((s) => s.id));
    const discrepancy = await this.discrepancyByTracking(subsidiaryId, from, to);
    // La ruta del envío (para el veredicto) también sale del historial, no de shipment.routeId.
    const routeDateByShipmentId = await this.routeDateByShipment(shipments.map((s) => s.id));

    const rows: GroupInputRow[] = shipments.map((s) => {
      const consId = (s as any).consolidatedId as string;
      const meta = consMetaById.get(consId);
      return this.shipmentRow(
        s,
        incomeByShipment.get(s.id) ?? null,
        consId,
        meta?.label ?? `Consolidado …${String(consId).slice(-6)}`,
        meta?.date ?? null,
        null,
        routeDateByShipmentId.get(s.id) ?? null,
      );
    });

    // Cargas (F2) de la semana cuyo consNumber pertenece a un consolidado de la semana.
    // Se anexan al grupo de su consolidado (por consNumber → consId).
    const consIdByNumber = new Map<string, string>();
    for (const [id, m] of consMetaById) if (m.consNumber) consIdByNumber.set(m.consNumber, id);
    if (consByNumber.size) {
      const secondAbordAmount = await this.secondAbordAmount(subsidiaryId);
      const charges = await this.incomeRepo
        .createQueryBuilder('income')
        .leftJoinAndSelect('income.shipment', 'shipment')
        .leftJoinAndSelect('income.charge', 'charge')
        .leftJoinAndSelect('income.subsidiary', 'subsidiary')
        .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
        .andWhere('income.active = 1')
        .andWhere('income.sourceType = :charge', { charge: IncomeSourceType.CHARGE })
        .getMany();
      for (const c of charges) {
        const consNumber = (c.charge as any)?.consNumber ?? null;
        const consId = consNumber ? consIdByNumber.get(consNumber) : undefined;
        if (!consId) continue;
        const meta = consMetaById.get(consId)!;
        const row = mapIncomeToRow(c);
        row.secondAbordAmount = secondAbordAmount;
        rows.push({
          tracking: c.trackingNumber ?? null,
          shipmentId: null,
          status: null,
          isShipment: false,
          commitDateTime: (c.charge as any)?.commitDateTime ? new Date((c.charge as any).commitDateTime).toISOString() : null,
          income: row,
          groupKey: consId,
          groupLabel: meta.label,
          groupDate: meta.date ? new Date(meta.date).toISOString() : null,
          driver: null,
          owner: null,
          verdict: NEUTRAL_OK,
        });
      }
    }

    return buildGroups(rows, discrepancy);
  }

  /** Arma la fila de un envío (con su ingreso completo y veredicto anclado a la ruta). */
  private shipmentRow(
    s: Shipment,
    incomeRow: ConsolidadorRow | null,
    groupKey: string,
    groupLabel: string,
    groupDate: Date | null,
    driver: string | null,
    routeDateForVerdict: Date | null,
  ): GroupInputRow {
    const verdict = computeVerdict({
      currentStatus: s.status ?? null,
      history: (s as any).statusHistory ?? [],
      hasConsolidado: !!(s as any).consolidatedId,
      routeDate: routeDateForVerdict,
      incomeDate: incomeRow ? incomeRow.date : null,
      fedexVerified: true, // el estatus ya viene resuelto por el cron; no llamamos a FedEx aquí
    });
    return {
      tracking: s.trackingNumber ?? null,
      shipmentId: s.id,
      status: (s.status as ShipmentStatusType) ?? null,
      isShipment: true,
      commitDateTime: (s as any).commitDateTime ? new Date((s as any).commitDateTime).toISOString() : null,
      income: incomeRow,
      groupKey,
      groupLabel,
      groupDate: groupDate ? new Date(groupDate).toISOString() : null,
      driver,
      owner: null,
      verdict,
    };
  }

  /** Envíos por consolidatedId (para la vista por consolidado) con historial de estatus. */
  private async loadShipments(fkColumn: 'consolidatedId', ids: string[], subsidiaryId?: string): Promise<Shipment[]> {
    const qb = this.incomeRepo.manager
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.statusHistory', 'sh')
      .where(`s.${fkColumn} IN (:...ids)`, { ids });
    if (subsidiaryId) qb.andWhere('s.subsidiaryId = :subsidiaryId', { subsidiaryId });
    return qb.getMany();
  }

  /** Envíos por id (para la vista por ruta, cuyos ids vienen del historial) con historial de estatus. */
  private async loadShipmentsByIds(ids: string[]): Promise<Shipment[]> {
    if (ids.length === 0) return [];
    return this.incomeRepo.manager
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.statusHistory', 'sh')
      .where('s.id IN (:...ids)', { ids })
      .getMany();
  }

  /** routeDate por shipmentId vía historial (la ruta a la que perteneció el envío). */
  private async routeDateByShipment(shipmentIds: string[]): Promise<Map<string, Date | null>> {
    const map = new Map<string, Date | null>();
    const ids = [...new Set(shipmentIds)];
    if (ids.length === 0) return map;
    const rows = await this.incomeRepo.manager
      .getRepository(PackageDispatchHistory)
      .createQueryBuilder('h')
      .innerJoin(PackageDispatch, 'pd', 'pd.id = h.dispatchId')
      .select('h.shipmentId', 'shipmentId')
      .addSelect('pd.routeDate', 'routeDate')
      .where('h.shipmentId IN (:...ids)', { ids })
      .getRawMany<{ shipmentId: string; routeDate: Date | null }>();
    // Toma la fecha de ruta más reciente por envío (si estuvo en varias rutas).
    for (const r of rows) {
      if (!r.shipmentId) continue;
      const prev = map.get(r.shipmentId);
      const cur = r.routeDate ? new Date(r.routeDate) : null;
      if (!map.has(r.shipmentId) || (cur && (!prev || cur > prev))) map.set(r.shipmentId, cur);
    }
    return map;
  }

  /** Ingresos activos de envío por shipmentId → fila de consolidador completa. */
  private async incomesByShipment(shipmentIds: string[]): Promise<Map<string, ConsolidadorRow>> {
    const map = new Map<string, ConsolidadorRow>();
    if (shipmentIds.length === 0) return map;
    const incomes = await this.incomeRepo.find({
      where: { shipment: { id: In(shipmentIds) }, active: true },
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    for (const i of incomes) if (i.shipment?.id) map.set(i.shipment.id, mapIncomeToRow(i));
    return map;
  }

  private async secondAbordAmount(subsidiaryId: string): Promise<number> {
    const sub = await this.incomeRepo.manager
      .getRepository(Subsidiary)
      .findOne({ where: { id: subsidiaryId }, select: ['secondAbordAmount'] });
    return Number(sub?.secondAbordAmount ?? 0);
  }

  /** Descuadre de cobros por guía (con razón) de la semana, para explicar el KPI y el chip por fila. */
  private async discrepancyByTracking(subsidiaryId: string, from: Date, to: Date): Promise<Map<string, ChargeIssue[]>> {
    const report = await this.cobrosAudit.audit(subsidiaryId, from, to);
    const map = new Map<string, ChargeIssue[]>();
    for (const rule of report.rules) {
      for (const r of [...rule.missing, ...rule.extra]) {
        const amount = (r.cost ?? 0) * (r.discrepancy === 'extra' ? r.count : 1);
        const item: ChargeIssue = {
          tracking: r.trackingNumber,
          discrepancy: r.discrepancy,
          reason: r.reason,
          amount,
          subCode: r.subCode,
          rule: r.rule,
        };
        const list = map.get(r.trackingNumber);
        if (list) list.push(item);
        else map.set(r.trackingNumber, [item]);
      }
    }
    return map;
  }
}
