import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { Subsidiary } from '../../entities/subsidiary.entity';
import { ShipmentType } from '../../common/enums/shipment-type.enum';
import { computeSecondAbordDelta } from '../logic/second-abord.util';
import { ManualKind, resolveManualIncomeCost } from '../logic/manual-income.util';
import { mapIncomeToRow } from '../read/consolidador-row.mapper';
import { ConsolidadorRow } from '../consolidador.types';

@Injectable()
export class ConsolidadorIncomeService {
  constructor(
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
  ) {}

  private async load(id: string): Promise<Income> {
    const income = await this.incomeRepo.findOne({
      where: { id },
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    if (!income) throw new NotFoundException('Ingreso no encontrado');
    return income;
  }

  /** Estampa la miga de auditoría y fija el nuevo costo (guarda `originalCost` la 1ª vez). */
  private stamp(income: Income, reason: string, userId: string, newCost: number) {
    if (income.originalCost == null) income.originalCost = Number(income.cost);
    income.cost = newCost;
    income.updatedById = userId;
    income.updatedAt = new Date();
    income.editReason = reason;
  }

  async editCost(id: string, cost: number, reason: string, userId: string): Promise<ConsolidadorRow> {
    const income = await this.load(id);
    this.stamp(income, reason, userId, Number(cost.toFixed(2)));
    await this.incomeRepo.save(income);
    return mapIncomeToRow(income);
  }

  async setSecondAbord(id: string, enabled: boolean, reason: string, userId: string): Promise<ConsolidadorRow> {
    const income = await this.load(id);
    const subsidiary: any = income.subsidiary ?? (await this.subsidiaryRepo.findOne({ where: { id: (income as any).subsidiaryId } }));
    const amount = Number(subsidiary?.secondAbordAmount ?? 0);
    // Estado actual: el flag por-fila manda; si es null, se infiere del default de la sucursal.
    const alreadyIncluded = income.secondAbordApplied ?? !!subsidiary?.chargeSecondAbord;
    const next = computeSecondAbordDelta(Number(income.cost), amount, enabled, alreadyIncluded);
    this.stamp(income, reason, userId, next);
    income.secondAbordApplied = enabled;
    await this.incomeRepo.save(income);
    return mapIncomeToRow(income);
  }

  async createManual(
    dto: { subsidiaryId: string; kind: ManualKind; trackingNumber?: string; cost: number; date: string; reason: string },
    userId: string,
  ): Promise<ConsolidadorRow> {
    const { cost, sourceType, incomeType } = resolveManualIncomeCost(dto.kind, { cost: dto.cost });

    // Día de la operación (mediodía local para caer con holgura dentro del día).
    const day = new Date(`${dto.date}T12:00:00.000`);
    const dayStart = new Date(`${dto.date}T00:00:00.000`);
    const dayEnd = new Date(`${dto.date}T23:59:59.999`);

    // Anti-duplicado: misma sucursal + guía + tipo + día. Solo cuando hay guía (una manual
    // libre sin guía no se puede deduplicar con certeza).
    if (dto.trackingNumber) {
      const existing = await this.incomeRepo.findOne({
        where: {
          subsidiary: { id: dto.subsidiaryId },
          trackingNumber: dto.trackingNumber,
          incomeType,
          date: Between(dayStart, dayEnd),
        },
      });
      if (existing) {
        throw new ConflictException('Ya existe un ingreso equivalente ese día para esa guía');
      }
    }

    const income = this.incomeRepo.create({
      subsidiary: { id: dto.subsidiaryId } as Subsidiary,
      trackingNumber: dto.trackingNumber,
      shipmentType: ShipmentType.FEDEX,
      incomeType,
      cost,
      isGrouped: false,
      sourceType,
      date: day,
      createdById: userId,
      editReason: dto.reason,
    });
    await this.incomeRepo.save(income);
    return mapIncomeToRow(income);
  }
}
