import { Injectable, Logger } from '@nestjs/common';
import { Between, DataSource } from 'typeorm';
import { Income } from 'src/entities/income.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { DeferredEffect } from '../tracking-sync.types';
import { weekRange } from './week.util';

export type IncomeMode = 'report' | 'persist';

export interface ProposedIncome {
  trackingNumber: string;
  incomeType: IncomeStatus;
  sourceEventKey: string;
  cost: number;
  occurredAt: Date;
  subsidiaryId: string | null;
  shipmentId: string;
  exists: boolean;
}

/**
 * Materializa los efectos de cobro (DeferredEffect type:'income') anclados al evento.
 * - 'report': NO escribe; solo calcula los ingresos propuestos y marca cuáles ya existen.
 * - 'persist': inserta los que falten, idempotente por (trackingNumber, incomeType, sourceEventKey).
 * El costo por guía se resuelve como en generateIncomes (subsidiary.fedexCostPackage).
 */
@Injectable()
export class IncomeExecutor {
  private readonly logger = new Logger(IncomeExecutor.name);

  constructor(private readonly dataSource: DataSource) {}

  private async resolveCost(subsidiaryId: string | null): Promise<number> {
    if (!subsidiaryId) return 0;
    const sub = await this.dataSource.getRepository(Subsidiary).findOne({
      where: { id: subsidiaryId },
      select: ['fedexCostPackage'] as any,
    });
    return Number((sub as any)?.fedexCostPackage ?? 0);
  }

  async execute(effects: DeferredEffect[], mode: IncomeMode): Promise<ProposedIncome[]> {
    const incomeEffects = (effects || []).filter((e) => e.type === 'income');
    const out: ProposedIncome[] = [];

    for (const e of incomeEffects) {
      const p = e.payload as any;
      const cost = await this.resolveCost(p.subsidiaryId);
      const occurredAt = new Date(p.occurredAt);
      const { start, end } = weekRange(occurredAt);
      const incomingDelivered = p.incomeType === IncomeStatus.ENTREGADO;

      // DEDUP CROSS-SOURCE: un solo ingreso por (guía, semana), sin importar el origen
      // (motor, cierre de ruta, legacy). ENTREGADO gana (upgrade). Ver spec §3.4.
      const existing = await this.dataSource.getRepository(Income).findOne({
        where: { trackingNumber: p.trackingNumber, date: Between(start, end) } as any,
        order: { date: 'DESC' } as any,
        select: ['id', 'incomeType'] as any,
      });

      out.push({
        trackingNumber: p.trackingNumber,
        incomeType: p.incomeType,
        sourceEventKey: p.eventKey,
        cost,
        occurredAt,
        subsidiaryId: p.subsidiaryId,
        shipmentId: p.shipmentId,
        exists: !!existing,
      });

      if (mode !== 'persist') continue;

      const existingDelivered = existing && String(existing.incomeType) === String(IncomeStatus.ENTREGADO);

      if (!existing) {
        // No hay ingreso esta semana → crear (anclado al evento).
        if (cost <= 0) {
          this.logger.error(`FINANCE_ERROR: cobro $0 (sucursal ${p.subsidiaryId}) guía ${p.trackingNumber}`);
          continue;
        }
        await this.dataSource.transaction(async (m) => {
          const dup = await m.findOne(Income, { where: { trackingNumber: p.trackingNumber, date: Between(start, end) } as any, select: ['id'] as any });
          if (dup) return; // carrera: otro proceso ya cobró esta semana
          const row = m.create(Income, {
            trackingNumber: p.trackingNumber,
            shipment: { id: p.shipmentId },
            subsidiary: { id: p.subsidiaryId },
            shipmentType: ShipmentType.FEDEX,
            cost,
            incomeType: p.incomeType,
            nonDeliveryStatus: p.exceptionCode ?? '',
            isGrouped: false,
            sourceType: IncomeSourceType.SHIPMENT,
            date: occurredAt,
            sourceEventKey: p.eventKey,
            createdAt: new Date(),
          } as any);
          await m.save(Income, row);
        });
      } else if (existingDelivered) {
        // Ya está cobrado como ENTREGADO → nada (la entrega es terminal).
      } else if (incomingDelivered) {
        // Existe un NO_ENTREGADO y llega ENTREGADO → UPGRADE ese mismo registro (gana la entrega).
        await this.dataSource.getRepository(Income).update(
          { id: (existing as any).id } as any,
          { incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null, date: occurredAt, sourceEventKey: p.eventKey } as any,
        );
      }
      // else: existe no-entregado y llega no-entregado → no duplica (nada).
    }
    return out;
  }
}
