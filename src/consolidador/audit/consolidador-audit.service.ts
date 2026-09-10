import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IncomeChangeLog } from '../../entities/income-change-log.entity';

export type AuditAction = 'cost_edit' | 'second_abord' | 'manual_create' | 'status_fix' | 'delete';

export interface AuditEntry {
  incomeId?: string | null;
  shipmentId?: string | null;
  action: AuditAction;
  field?: string | null;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  reason?: string | null;
  userId?: string | null;
}

@Injectable()
export class ConsolidadorAuditService {
  constructor(@InjectRepository(IncomeChangeLog) private readonly logRepo: Repository<IncomeChangeLog>) {}

  /** Registra una fila de historial. Nunca rompe la operación principal si el log falla. */
  async record(entry: AuditEntry): Promise<void> {
    const row = this.logRepo.create({
      incomeId: entry.incomeId ?? null,
      shipmentId: entry.shipmentId ?? null,
      action: entry.action,
      field: entry.field ?? null,
      oldValue: entry.oldValue != null ? String(entry.oldValue) : null,
      newValue: entry.newValue != null ? String(entry.newValue) : null,
      reason: entry.reason ?? null,
      userId: entry.userId ?? null,
    });
    await this.logRepo.save(row);
  }

  /** Historial de un ingreso, más reciente primero. */
  async history(incomeId: string): Promise<IncomeChangeLog[]> {
    return this.logRepo.find({ where: { incomeId }, order: { createdAt: 'DESC' } });
  }
}
