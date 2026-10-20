import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { effectiveLocalDay } from 'src/common/income-window.util';
import { toHermosilloDateString } from 'src/common/utils';
import { sqlDay } from '../logic/sql-day.util';
import { classifyCollectionAudit } from '../logic/collection-audit.util';
import { pickedUpDayOf } from '../logic/manual-count-collection.util';
import { ManualCountService } from './manual-count.service';
import type { CollectionAuditRow, CollectionsAuditReport } from '../zone/zone.types';

const OFFSET_MS = 7 * 3600 * 1000; // Hermosillo = UTC-7 fijo
const inList = (n: number) => Array(n).fill('?').join(',');
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const safeJson = (s: string): unknown => {
  try { return JSON.parse(s); } catch { return null; }
};

/**
 * Recolecciones registradas en la semana con su ruta (cierre), si son 31.5, su cobro y lo que
 * diga FedEx ("recogido") si ya está en caché. Solo lectura.
 */
@Injectable()
export class CollectionsAuditService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly manualCount: ManualCountService,
  ) {}

  async report(subsidiaryId: string, from: string, to: string): Promise<CollectionsAuditReport> {
    const start = new Date(new Date(`${from}T00:00:00.000Z`).getTime() + OFFSET_MS);
    const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000 + OFFSET_MS);
    const [subRow] = await this.dataSource.query(`SELECT fedexCostPackage FROM subsidiary WHERE id = ? LIMIT 1`, [subsidiaryId]);
    const expectedCost = Number(subRow?.fedexCostPackage ?? 0);

    const regs: any[] = await this.dataSource.query(
      `SELECT trackingNumber AS tn, MIN(createdAt) AS createdAt FROM collection
        WHERE subsidiaryId = ? AND createdAt >= ? AND createdAt < ? GROUP BY trackingNumber`,
      [subsidiaryId, start, end],
    );
    const tns = regs.map((r) => String(r.tn)).filter(Boolean);
    if (!tns.length) return { rows: [], totals: { registered: 0, charged: 0, withoutCharge: 0 }, expectedCost };

    const [incRows, closureRows] = await Promise.all([
      this.dataSource.query(
        `SELECT id, trackingNumber AS tn, date, cost, sourceType FROM income
          WHERE active = 1 AND sourceType = 'collection' AND trackingNumber IN (${inList(tns.length)})`,
        tns,
      ),
      this.dataSource.query(
        `SELECT rc.collections, pd.trackingNumber AS folio, pd.routeDate, pd.is315, rc.createdAt
           FROM route_closure rc JOIN package_dispatch pd ON pd.id = rc.package_dispatch_id
          WHERE pd.subsidiaryId = ? AND rc.createdAt >= ? AND rc.createdAt < ?`,
        [subsidiaryId, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000)],
      ),
    ]);

    const routeByTn = new Map<string, { label: string; is315: boolean }>();
    for (const r of closureRows) {
      const list = typeof r.collections === 'string' ? safeJson(r.collections) : r.collections;
      const day = sqlDay(r.routeDate) ?? toHermosilloDateString(new Date(r.createdAt));
      for (const tn of Array.isArray(list) ? list : []) {
        routeByTn.set(String(tn), { label: `Ruta ${r.folio ?? ''} · ${ddmm(day)}`.trim(), is315: Number(r.is315) === 1 });
      }
    }
    const incomesByTn = new Map<string, { id: string; cost: number; day: string }[]>();
    for (const i of incRows) {
      const tn = String(i.tn);
      incomesByTn.set(tn, [...(incomesByTn.get(tn) ?? []), { id: String(i.id), cost: Number(i.cost ?? 0), day: effectiveLocalDay({ sourceType: i.sourceType, date: i.date }) }]);
    }

    const rows: CollectionAuditRow[] = regs.map((r) => {
      const tn = String(r.tn);
      const route = routeByTn.get(tn) ?? null;
      const incomes = incomesByTn.get(tn) ?? [];
      const track = this.manualCount.cachedTrack(tn);
      const is315 = !!route?.is315;
      return {
        trackingNumber: tn,
        day: toHermosilloDateString(new Date(r.createdAt)),
        registeredAt: new Date(r.createdAt).toISOString(),
        routeLabel: route?.label ?? null,
        is315,
        fedexPickedUpDay: track ? pickedUpDayOf(track, toHermosilloDateString) : null,
        fedexChecked: !!track,
        status: classifyCollectionAudit({ is315, activeIncomes: incomes.length }),
        incomeIds: incomes.map((i) => i.id),
        amount: incomes.reduce((s, i) => s + i.cost, 0),
      };
    });
    rows.sort((a, b) => a.day.localeCompare(b.day) || a.trackingNumber.localeCompare(b.trackingNumber));
    return {
      rows,
      totals: {
        registered: rows.length,
        charged: rows.filter((r) => r.status === 'cobrada' || r.status === 'duplicada').length,
        withoutCharge: rows.filter((r) => r.status === 'sin_cobro').length,
      },
      expectedCost,
    };
  }
}
