import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { Subsidiary } from '../../entities/subsidiary.entity';
import { ConsolidadorBuckets, ConsolidadorReadResult, ConsolidadorRow } from '../consolidador.types';
import { mapIncomeToRow } from './consolidador-row.mapper';
import { detectAnomalies, Anomaly } from '../logic/detect-anomalies.util';

const TRASLADO = ['tyco', 'aeropuerto', 'special_transfer'];

export type AnomalyRow = ConsolidadorRow & {
  anomalies: Anomaly[];
  statusDate: string | null;
  statusHistory: Array<{ status: string; timestamp: string | null }>;
};

@Injectable()
export class ConsolidadorReadService {
  constructor(@InjectRepository(Income) private readonly incomeRepo: Repository<Income>) {}

  /** Barre la semana de la sucursal y devuelve solo los ingresos con anomalías detectadas. */
  async getWeekAnomalies(subsidiaryId: string, fromDate: Date, toDate: Date): Promise<{ rows: AnomalyRow[] }> {
    const list = await this.incomeRepo
      .createQueryBuilder('income')
      .leftJoinAndSelect('income.shipment', 'shipment')
      .leftJoinAndSelect('shipment.statusHistory', 'sh')
      .leftJoinAndSelect('income.charge', 'charge')
      .leftJoinAndSelect('income.subsidiary', 'subsidiary')
      .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('income.date BETWEEN :fromDate AND :toDate', { fromDate, toDate })
      .andWhere('income.active = 1')
      .getMany();

    const rows: AnomalyRow[] = [];
    for (const i of list) {
      // Solo los ENVÍOS (shipment) se revisan contra estatus/FedEx. Cargas, recolecciones,
      // traslados y manuales no tienen historial de estatus y no aplican para anomalías.
      if (i.sourceType !== 'shipment') continue;
      const history = ((i.shipment as any)?.statusHistory ?? []).map((s: any) => ({ status: s.status, timestamp: s.timestamp }));
      const statusDate = this.latestStatusDate(history);
      const anomalies = detectAnomalies({
        currentStatus: (i.shipment as any)?.status ?? null,
        history,
        income: { date: i.date },
        statusDate,
      });
      if (anomalies.length) {
        const statusHistory = history
          .map((s: any) => ({ status: String(s.status ?? ''), timestamp: s.timestamp ? new Date(s.timestamp).toISOString() : null }))
          .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());
        rows.push({ ...mapIncomeToRow(i), anomalies, statusDate, statusHistory });
      }
    }
    return { rows };
  }

  private latestStatusDate(history: Array<{ timestamp?: Date | string | null }>): string | null {
    if (!history?.length) return null;
    const max = history.reduce<Date | null>((acc, s) => {
      const t = s.timestamp ? new Date(s.timestamp) : null;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    return max ? max.toISOString() : null;
  }

  async getWeek(
    subsidiaryId: string,
    fromDate: Date,
    toDate: Date,
    filters: { consNumber?: string; routeId?: string },
  ): Promise<ConsolidadorReadResult> {
    const qb = this.incomeRepo
      .createQueryBuilder('income')
      .leftJoinAndSelect('income.shipment', 'shipment')
      .leftJoinAndSelect('income.charge', 'charge')
      // Join manual a `consolidated` para poder filtrar envíos por su consNumber.
      .leftJoin('consolidated', 'cons', 'cons.id = shipment.consolidatedId')
      .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('income.date BETWEEN :fromDate AND :toDate', { fromDate, toDate })
      .andWhere('income.active = 1');

    if (filters.consNumber) {
      qb.andWhere('(charge.consNumber = :consNumber OR cons.consNumber = :consNumber)', {
        consNumber: filters.consNumber,
      });
    }
    if (filters.routeId) {
      qb.andWhere('shipment.routeId = :routeId', { routeId: filters.routeId });
    }

    const list = await qb.getMany();
    const rows = list.map((i) => mapIncomeToRow(i));

    // El query no carga subsidiary; traemos el monto del 2º a bordo una vez (reporte por sucursal)
    // y lo estampamos para poder desglosar el costo de las cargas en la edición.
    const sub = await this.incomeRepo.manager
      .getRepository(Subsidiary)
      .findOne({ where: { id: subsidiaryId }, select: ['secondAbordAmount'] });
    const secondAbordAmount = Number(sub?.secondAbordAmount ?? 0);
    for (const r of rows) r.secondAbordAmount = secondAbordAmount;

    return { rows, buckets: this.buckets(rows) };
  }

  private buckets(rows: ConsolidadorRow[]): ConsolidadorBuckets {
    const mk = () => ({ amount: 0, count: 0 });
    const b: ConsolidadorBuckets = {
      envios: mk(),
      cargas: mk(),
      recolecciones: mk(),
      traslados: mk(),
      manual: mk(),
      total: mk(),
    };
    for (const r of rows) {
      const key =
        r.sourceType === 'shipment'
          ? 'envios'
          : r.sourceType === 'charge'
            ? 'cargas'
            : r.sourceType === 'collection'
              ? 'recolecciones'
              : TRASLADO.includes(String(r.sourceType))
                ? 'traslados'
                : 'manual';
      b[key].amount += r.cost;
      b[key].count += 1;
      b.total.amount += r.cost;
      b.total.count += 1;
    }
    return b;
  }
}
