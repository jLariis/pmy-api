import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConsolidadorReadService } from './consolidador-read.service';
import { CobrosAuditService } from '../audit/cobros-audit.service';
import { ChargeGuidesService } from '../audit/charge-guides.service';
import { CollectionsAuditService } from '../audit/collections-audit.service';
import { NoVanAuditService } from '../audit/novan-audit.service';
import { buildTopIssue } from '../logic/summary-issue.util';
import type { SubsidiarySummary } from '../zone/zone.types';

const money = (amount: number) => `$${Math.round(amount).toLocaleString('en-US')}`;

/** Resumen de la semana de UNA sucursal (pestaña Resumen del Consolidador). Solo lectura. */
@Injectable()
export class SummaryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly read: ConsolidadorReadService,
    private readonly cobrosAudit: CobrosAuditService,
    private readonly chargeGuides: ChargeGuidesService,
    private readonly collections: CollectionsAuditService,
    private readonly novan: NoVanAuditService,
  ) {}

  async forSubsidiary(subsidiaryId: string, fromDate: string, toDate: string): Promise<SubsidiarySummary> {
    const from = new Date(`${fromDate}T00:00:00.000`);
    const to = new Date(`${toDate}T23:59:59.999`);
    // En secuencia (no en paralelo): por zona ya corren 2 sucursales a la vez.
    const week = await this.read.getWeek(subsidiaryId, from, to, {} as any);
    const audit = await this.cobrosAudit.audit(subsidiaryId, from, to);
    const charges = await this.chargeGuides.report(subsidiaryId, fromDate, toDate);
    const cols = await this.collections.report(subsidiaryId, fromDate, toDate);
    const nv = await this.novan.report(subsidiaryId, fromDate, toDate);
    const [run] = await this.dataSource.query(
      `SELECT differences, scope, createdAt FROM manual_count_run
        WHERE subsidiaryId = ? AND toDay >= ? AND toDay <= ? ORDER BY createdAt DESC LIMIT 1`,
      [subsidiaryId, fromDate, toDate],
    );

    const base: Omit<SubsidiarySummary, 'topIssue' | 'level'> = {
      incomeTotal: Number(week.buckets.total.amount ?? 0),
      packages: Number(week.buckets.envios.count ?? 0),
      charges: Number(week.buckets.cargas.count ?? 0),
      missing: { count: audit.totals.missingCount, amount: audit.totals.missingAmount },
      extra: {
        count: audit.totals.extraCount + charges.totals.overcharged,
        amount: audit.totals.extraAmount + charges.totals.overchargedAmount,
      },
      doubles: charges.totals.doubles,
      collections: { registered: cols.totals.registered, charged: cols.totals.charged, withoutCharge: cols.totals.withoutCharge },
      novan: { total: nv.totals.total, charged: nv.totals.charged, withoutCharge: nv.totals.withoutCharge },
      lastManualCount: run
        ? { differences: Number(run.differences), scope: run.scope === 'week' ? 'week' : 'day', createdAt: new Date(run.createdAt).toISOString() }
        : null,
    };
    return { ...base, ...buildTopIssue(base, money) };
  }
}
