import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { PackageDispatch } from '../../entities/package-dispatch.entity';
import { Consolidated } from '../../entities/consolidated.entity';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { CobrosAuditService } from '../audit/cobros-audit.service';
import { computeVerdict, Verdict } from '../logic/package-verdict.util';
import { buildGroups } from '../logic/consolidador-groups.util';
import { ConsolidadorGroupsResult, GroupInputRow } from '../consolidador.types';

const NEUTRAL_OK: Verdict = { code: 'no_income_ok', level: 'ok', title: '', evidence: [], suggestedAction: { kind: 'none' } };

interface RouteMeta {
  routeDate: Date | null;
  number: string | null;
  driver: string | null;
}
interface ConsMeta {
  consNumber: string | null;
  date: Date | null;
}

/**
 * Lectura agregada del Consolidador: agrupa la semana de la sucursal POR RUTA o POR CONSOLIDADO,
 * con KPIs (entregados/no entregados, ingresos, descuadre de cobros, anomalías) y el detalle de
 * guías con veredicto. Read-only; reusa `CobrosAuditService` para el descuadre y `computeVerdict`
 * para el análisis por guía (sin llamar a FedEx: usa el estatus ya persistido).
 */
@Injectable()
export class ConsolidadorGroupsService {
  constructor(
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    private readonly cobrosAudit: CobrosAuditService,
  ) {}

  async getByRoute(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult> {
    const { incomes, routeById } = await this.load(subsidiaryId, from, to);
    const discrepancy = await this.discrepancyByTracking(subsidiaryId, from, to);

    const rows: GroupInputRow[] = incomes.map((i) => {
      const routeId = (i.shipment as any)?.routeId ?? null;
      const meta = routeId ? routeById.get(routeId) : undefined;
      const key = routeId ?? '__noroute__';
      const label = meta
        ? `Ruta ${meta.number ?? `…${String(routeId).slice(-6)}`}`
        : 'Sin ruta';
      return this.toRow(i, key, label, meta?.routeDate ?? null, meta?.driver ?? null, null, routeById);
    });

    return buildGroups(rows, discrepancy);
  }

  async getByConsolidado(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult> {
    const { incomes, routeById, consById } = await this.load(subsidiaryId, from, to);
    const discrepancy = await this.discrepancyByTracking(subsidiaryId, from, to);

    const rows: GroupInputRow[] = incomes.map((i) => {
      const consId = (i.shipment as any)?.consolidatedId ?? null;
      const consMeta = consId ? consById.get(consId) : undefined;
      const consNumber = consMeta?.consNumber ?? (i.charge as any)?.consNumber ?? null;
      const key = consNumber ?? '__nocons__';
      const label = consNumber ? `Consolidado ${consNumber}` : 'Sin consolidado';
      const date = consMeta?.date ?? null;
      return this.toRow(i, key, label, date, null, null, routeById);
    });

    return buildGroups(rows, discrepancy);
  }

  /** Normaliza un income a fila de entrada del agrupador, calculando el veredicto (solo envíos). */
  private toRow(
    i: Income,
    groupKey: string,
    groupLabel: string,
    groupDate: Date | null,
    driver: string | null,
    owner: string | null,
    routeById: Map<string, RouteMeta>,
  ): GroupInputRow {
    const isShipment = i.sourceType === IncomeSourceType.SHIPMENT;
    const shipment = (i.shipment as any) ?? null;
    let verdict: Verdict = NEUTRAL_OK;
    if (isShipment && shipment) {
      const routeId = shipment.routeId ?? null;
      const routeDate = routeId ? routeById.get(routeId)?.routeDate ?? null : null;
      verdict = computeVerdict({
        currentStatus: shipment.status ?? null,
        history: shipment.statusHistory ?? [],
        hasConsolidado: !!shipment.consolidatedId,
        routeDate,
        incomeDate: i.date,
        fedexVerified: true, // el estatus ya viene resuelto por el cron; no llamamos a FedEx aquí
      });
    }
    return {
      tracking: i.trackingNumber ?? shipment?.trackingNumber ?? null,
      shipmentId: shipment?.id ?? null,
      status: (shipment?.status as ShipmentStatusType) ?? null,
      isShipment,
      cost: Number(i.cost) || 0,
      incomeId: i.id,
      groupKey,
      groupLabel,
      groupDate: groupDate ? new Date(groupDate).toISOString() : null,
      driver,
      owner,
      verdict,
    };
  }

  /** Carga los ingresos activos de la semana + mapas de ruta y consolidado. */
  private async load(subsidiaryId: string, from: Date, to: Date) {
    const incomes = await this.incomeRepo
      .createQueryBuilder('income')
      .leftJoinAndSelect('income.shipment', 'shipment')
      .leftJoinAndSelect('shipment.statusHistory', 'sh')
      .leftJoinAndSelect('income.charge', 'charge')
      .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('income.date BETWEEN :from AND :to', { from, to })
      .andWhere('income.active = 1')
      .getMany();

    const routeIds = [...new Set(incomes.map((i) => (i.shipment as any)?.routeId).filter(Boolean))] as string[];
    const consIds = [...new Set(incomes.map((i) => (i.shipment as any)?.consolidatedId).filter(Boolean))] as string[];

    const routeById = new Map<string, RouteMeta>();
    if (routeIds.length) {
      const dispatches = await this.incomeRepo.manager
        .getRepository(PackageDispatch)
        .find({ where: { id: In(routeIds) }, relations: ['drivers'] });
      for (const pd of dispatches) {
        const driver = ((pd as any).drivers ?? []).map((d: any) => d?.name).filter(Boolean).join(', ') || null;
        routeById.set(pd.id, {
          routeDate: (pd as any).routeDate ?? (pd as any).createdAt ?? null,
          number: (pd as any).trackingNumber ?? null,
          driver,
        });
      }
    }

    const consById = new Map<string, ConsMeta>();
    if (consIds.length) {
      const cons = await this.incomeRepo.manager
        .getRepository(Consolidated)
        .find({ where: { id: In(consIds) } });
      for (const c of cons) consById.set(c.id, { consNumber: c.consNumber ?? null, date: c.date ?? null });
    }

    return { incomes, routeById, consById };
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
