import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Income } from 'src/entities/income.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { DeferredEffect } from '../tracking-sync.types';

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
      const existing = await this.dataSource.getRepository(Income).findOne({
        where: { trackingNumber: p.trackingNumber, incomeType: p.incomeType, sourceEventKey: p.eventKey } as any,
        select: ['id'] as any,
      });

      out.push({
        trackingNumber: p.trackingNumber,
        incomeType: p.incomeType,
        sourceEventKey: p.eventKey,
        cost,
        occurredAt: new Date(p.occurredAt),
        subsidiaryId: p.subsidiaryId,
        shipmentId: p.shipmentId,
        exists: !!existing,
      });

      if (mode === 'persist' && !existing) {
        if (cost <= 0) {
          this.logger.error(`FINANCE_ERROR: cobro $0 (sucursal ${p.subsidiaryId}) guía ${p.trackingNumber}`);
          continue;
        }
        await this.dataSource.transaction(async (m) => {
          // Re-chequeo dentro de la TX (carrera con otra corrida).
          const dup = await m.findOne(Income, {
            where: { trackingNumber: p.trackingNumber, incomeType: p.incomeType, sourceEventKey: p.eventKey } as any,
            select: ['id'] as any,
          });
          if (dup) return;
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
            date: new Date(p.occurredAt),
            sourceEventKey: p.eventKey,
            createdAt: new Date(),
          } as any);
          await m.save(Income, row);
        });
      }
    }
    return out;
  }
}
