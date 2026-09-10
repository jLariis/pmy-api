import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { Subsidiary } from '../../entities/subsidiary.entity';
import { computeSecondAbordDelta } from '../logic/second-abord.util';
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
}
