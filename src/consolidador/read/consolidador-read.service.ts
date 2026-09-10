import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { ConsolidadorBuckets, ConsolidadorReadResult, ConsolidadorRow } from '../consolidador.types';
import { mapIncomeToRow } from './consolidador-row.mapper';

const TRASLADO = ['tyco', 'aeropuerto', 'special_transfer'];

@Injectable()
export class ConsolidadorReadService {
  constructor(@InjectRepository(Income) private readonly incomeRepo: Repository<Income>) {}

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
