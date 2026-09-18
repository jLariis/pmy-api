import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { Shipment } from '../../entities/shipment.entity';
import { PackageDispatch } from '../../entities/package-dispatch.entity';
import { Consolidated } from '../../entities/consolidated.entity';
import { Subsidiary } from '../../entities/subsidiary.entity';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { CobrosAuditService } from '../audit/cobros-audit.service';
import { computeVerdict, Verdict } from '../logic/package-verdict.util';
import { buildGroups } from '../logic/consolidador-groups.util';
import { mapIncomeToRow } from './consolidador-row.mapper';
import { ConsolidadorGroupsResult, ConsolidadorRow, GroupInputRow } from '../consolidador.types';

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

  // ---- POR RUTA: rutas de la semana (routeDate) ----
  async getByRoute(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult> {
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

    const shipments = await this.loadShipments('routeId', routeIds);
    const incomeByShipment = await this.incomesByShipment(shipments.map((s) => s.id));
    const discrepancy = await this.discrepancyByTracking(subsidiaryId, from, to);
    const routeDateById = new Map([...routeMeta].map(([id, m]) => [id, m.date] as [string, Date | null]));

    const rows: GroupInputRow[] = shipments.map((s) => {
      const meta = routeMeta.get((s as any).routeId);
      return this.shipmentRow(
        s,
        incomeByShipment.get(s.id) ?? null,
        (s as any).routeId ?? '__noroute__',
        meta ? `Ruta ${meta.number ?? `…${String((s as any).routeId).slice(-6)}`}` : 'Sin ruta',
        meta?.date ?? null,
        meta?.driver ?? null,
        routeDateById,
      );
    });

    return buildGroups(rows, discrepancy);
  }

  // ---- POR CONSOLIDADO: consolidados de la semana (date) ----
  async getByConsolidado(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult> {
    const consolidados = await this.incomeRepo.manager
      .getRepository(Consolidated)
      .find({ where: { date: Between(from, to) } });
    const consByNumber = new Map<string, Date | null>();
    const consIds: string[] = [];
    for (const c of consolidados) {
      consIds.push(c.id);
      if (c.consNumber) consByNumber.set(c.consNumber, c.date ?? null);
    }
    if (consIds.length === 0) return { groups: [] };

    // Envíos de la sucursal en esos consolidados.
    const shipments = await this.loadShipments('consolidatedId', consIds, subsidiaryId);
    const incomeByShipment = await this.incomesByShipment(shipments.map((s) => s.id));
    const discrepancy = await this.discrepancyByTracking(subsidiaryId, from, to);
    const consNumberByShipmentId = new Map<string, string | null>();
    // Recupera el consNumber por el consolidatedId del envío.
    const consNumberById = new Map<string, string | null>(consolidados.map((c) => [c.id, c.consNumber ?? null]));
    for (const s of shipments) consNumberByShipmentId.set(s.id, consNumberById.get((s as any).consolidatedId) ?? null);

    const routeDateById = await this.loadRouteDates(shipments.map((s) => (s as any).routeId).filter(Boolean));

    const rows: GroupInputRow[] = shipments.map((s) => {
      const consNumber = consNumberByShipmentId.get(s.id) ?? null;
      return this.shipmentRow(
        s,
        incomeByShipment.get(s.id) ?? null,
        consNumber ?? '__nocons__',
        consNumber ? `Consolidado ${consNumber}` : 'Sin consolidado',
        consNumber ? consByNumber.get(consNumber) ?? null : null,
        null,
        routeDateById,
      );
    });

    // Cargas (F2) de la semana cuyo consNumber pertenece a un consolidado de la semana.
    const weekConsNumbers = [...consByNumber.keys()];
    if (weekConsNumbers.length) {
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
        if (!consNumber || !consByNumber.has(consNumber)) continue;
        const row = mapIncomeToRow(c);
        row.secondAbordAmount = secondAbordAmount;
        rows.push({
          tracking: c.trackingNumber ?? null,
          shipmentId: null,
          status: null,
          isShipment: false,
          income: row,
          groupKey: consNumber,
          groupLabel: `Consolidado ${consNumber}`,
          groupDate: consByNumber.get(consNumber) ? new Date(consByNumber.get(consNumber)!).toISOString() : null,
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
    routeDateById: Map<string, Date | null>,
  ): GroupInputRow {
    const routeId = (s as any).routeId ?? null;
    const routeDate = routeId ? routeDateById.get(routeId) ?? null : null;
    const verdict = computeVerdict({
      currentStatus: s.status ?? null,
      history: (s as any).statusHistory ?? [],
      hasConsolidado: !!(s as any).consolidatedId,
      routeDate,
      incomeDate: incomeRow ? incomeRow.date : null,
      fedexVerified: true, // el estatus ya viene resuelto por el cron; no llamamos a FedEx aquí
    });
    return {
      tracking: s.trackingNumber ?? null,
      shipmentId: s.id,
      status: (s.status as ShipmentStatusType) ?? null,
      isShipment: true,
      income: incomeRow,
      groupKey,
      groupLabel,
      groupDate: groupDate ? new Date(groupDate).toISOString() : null,
      driver,
      owner: null,
      verdict,
    };
  }

  /** Envíos por una columna FK (routeId/consolidatedId) con historial de estatus. */
  private async loadShipments(fkColumn: 'routeId' | 'consolidatedId', ids: string[], subsidiaryId?: string): Promise<Shipment[]> {
    const qb = this.incomeRepo.manager
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.statusHistory', 'sh')
      .where(`s.${fkColumn} IN (:...ids)`, { ids });
    if (subsidiaryId) qb.andWhere('s.subsidiaryId = :subsidiaryId', { subsidiaryId });
    return qb.getMany();
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

  /** routeDate por routeId (para el veredicto). */
  private async loadRouteDates(routeIds: string[]): Promise<Map<string, Date | null>> {
    const map = new Map<string, Date | null>();
    const unique = [...new Set(routeIds)];
    if (unique.length === 0) return map;
    const dispatches = await this.incomeRepo.manager.getRepository(PackageDispatch).find({ where: { id: In(unique) } });
    for (const pd of dispatches) map.set(pd.id, (pd as any).routeDate ?? (pd as any).createdAt ?? null);
    return map;
  }

  private async secondAbordAmount(subsidiaryId: string): Promise<number> {
    const sub = await this.incomeRepo.manager
      .getRepository(Subsidiary)
      .findOne({ where: { id: subsidiaryId }, select: ['secondAbordAmount'] });
    return Number(sub?.secondAbordAmount ?? 0);
  }

  /** Descuadre de cobros por guía (missing + extra) de la semana, para sumar por grupo. */
  private async discrepancyByTracking(subsidiaryId: string, from: Date, to: Date): Promise<Map<string, number>> {
    const report = await this.cobrosAudit.audit(subsidiaryId, from, to);
    const map = new Map<string, number>();
    for (const rule of report.rules) {
      for (const r of [...rule.missing, ...rule.extra]) {
        const amount = (r.cost ?? 0) * (r.discrepancy === 'extra' ? r.count : 1);
        map.set(r.trackingNumber, (map.get(r.trackingNumber) ?? 0) + amount);
      }
    }
    return map;
  }
}
