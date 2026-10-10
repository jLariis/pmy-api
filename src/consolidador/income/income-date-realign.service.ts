import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { toHermosilloDateString } from '../../common/utils';
import { ConsolidadorAuditService } from '../audit/consolidador-audit.service';
import { isDayStartAnchored, resolveIncomeEventDate } from '../logic/income-date-realign.util';

export interface DateRealignRow {
  incomeId: string;
  trackingNumber: string;
  incomeType: string;
  nonDeliveryStatus: string | null;
  cost: number;
  currentDate: string;
  currentDay: string;
  correctDate: string | null;
  correctDay: string | null;
  basis: string | null;
  /** fix = se corrige; no_event = sin evento FedEx claro (se deja como está). */
  action: 'fix' | 'no_event';
}

/**
 * Corrección de fechas de ingresos de guías FedEx que quedaron a las 00:00 del día de la ruta
 * (07:00:00Z) en vez de la fecha real del evento FedEx (bug del cierre de ruta, Loreto 06-oct).
 * Vista previa por sucursal + semana y aplicación con bitácora (`IncomeChangeLog`, `date_fix`).
 * Solo toca `income.date`; nunca costo, tipo ni estatus.
 */
@Injectable()
export class IncomeDateRealignService {
  constructor(
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    private readonly dataSource: DataSource,
    private readonly audit: ConsolidadorAuditService,
  ) {}

  /**
   * Candidatos: ingresos activos de guía FedEx (sourceType shipment) de la sucursal, fechados a
   * las 00:00 Hermosillo, cuyo día actual O día correcto cae en la semana [fromDay, toDay].
   * Se busca desde 7 días antes para traer los que quedaron en la semana anterior por error.
   */
  async preview(subsidiaryId: string, fromDay: string, toDay: string): Promise<DateRealignRow[]> {
    const lowerUtc = new Date(`${fromDay}T07:00:00.000Z`);
    lowerUtc.setUTCDate(lowerUtc.getUTCDate() - 7);
    const upperUtc = new Date(`${toDay}T07:00:00.000Z`);
    upperUtc.setUTCDate(upperUtc.getUTCDate() + 1);

    const incomes = await this.incomeRepo
      .createQueryBuilder('i')
      .leftJoin('i.shipment', 's')
      .select(['i.id', 'i.trackingNumber', 'i.incomeType', 'i.nonDeliveryStatus', 'i.cost', 'i.date', 's.id'])
      .where('i.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('i.active = 1')
      .andWhere('i.sourceType = :st', { st: IncomeSourceType.SHIPMENT })
      .andWhere('LOWER(i.shipmentType) = :fedex', { fedex: 'fedex' })
      .andWhere('s.id IS NOT NULL')
      .andWhere('i.date >= :lower AND i.date < :upper', { lower: lowerUtc, upper: upperUtc })
      .getMany();

    const anchored = incomes.filter((i) => isDayStartAnchored(i.date));
    if (!anchored.length) return [];

    const shipmentIds = [...new Set(anchored.map((i) => i.shipment!.id))];
    const historyRows: any[] = await this.dataSource.query(
      `SELECT shipmentId, status, timestamp, exceptionCode, notes FROM shipment_status WHERE shipmentId IN (?)`,
      [shipmentIds],
    );
    const historyBy = new Map<string, any[]>();
    for (const r of historyRows) {
      const list = historyBy.get(r.shipmentId) ?? [];
      list.push(r);
      historyBy.set(r.shipmentId, list);
    }

    const rows: DateRealignRow[] = [];
    for (const i of anchored) {
      const currentDay = toHermosilloDateString(i.date);
      const decision = resolveIncomeEventDate(i, historyBy.get(i.shipment!.id) ?? []);
      const correctDay = decision ? toHermosilloDateString(decision.correctDate) : null;
      const inWeek = (d: string | null) => !!d && d >= fromDay && d <= toDay;
      if (!inWeek(currentDay) && !inWeek(correctDay)) continue;
      if (decision && decision.correctDate.getTime() === new Date(i.date).getTime()) continue;
      rows.push({
        incomeId: i.id,
        trackingNumber: i.trackingNumber,
        incomeType: String(i.incomeType),
        nonDeliveryStatus: i.nonDeliveryStatus ?? null,
        cost: Number(i.cost),
        currentDate: new Date(i.date).toISOString(),
        currentDay,
        correctDate: decision ? decision.correctDate.toISOString() : null,
        correctDay,
        basis: decision?.basis ?? null,
        action: decision ? 'fix' : 'no_event',
      });
    }
    return rows.sort((a, b) => a.currentDate.localeCompare(b.currentDate) || a.trackingNumber.localeCompare(b.trackingNumber));
  }

  /**
   * Aplica la corrección. Recalcula la vista previa en el servidor (no confía en fechas del
   * cliente) y solo corrige las filas `fix` cuyo id venga en `incomeIds` (o todas si no viene).
   */
  async apply(
    subsidiaryId: string,
    fromDay: string,
    toDay: string,
    incomeIds: string[] | undefined,
    reason: string,
    userId: string,
  ): Promise<{ fixed: number; rows: DateRealignRow[] }> {
    const wanted = incomeIds?.length ? new Set(incomeIds) : null;
    const rows = (await this.preview(subsidiaryId, fromDay, toDay)).filter(
      (r) => r.action === 'fix' && (!wanted || wanted.has(r.incomeId)),
    );
    for (const r of rows) {
      await this.incomeRepo.update(r.incomeId, {
        date: new Date(r.correctDate!),
        updatedById: userId,
        updatedAt: new Date(),
        editReason: reason,
      } as any);
      await this.audit.record({
        incomeId: r.incomeId,
        action: 'date_fix',
        field: 'date',
        oldValue: r.currentDate,
        newValue: r.correctDate,
        reason,
        userId,
      });
    }
    return { fixed: rows.length, rows };
  }
}
