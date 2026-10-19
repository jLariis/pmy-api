import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { diagnoseGuide } from '../logic/manual-count-diagnose.util';
import { weekDaysOf } from '../logic/manual-count-week.util';
import { locateGuides, type GuideCandidate } from '../logic/zone-locate.util';
import { runWithLimit } from '../logic/zone-scope.util';
import { sqlDay } from '../logic/sql-day.util';
import type { DiagnosisRow, GuideFacts, ManualCountReport, ManualCountScope, ManualLists, Mark } from '../logic/manual-count.types';
import { ZoneService, type ZoneUser } from '../zone/zone.service';
import { ManualCountService } from './manual-count.service';

const inList = (n: number) => Array(n).fill('?').join(',');
const clean = (list: string[] | undefined) => [...new Set((list ?? []).map((t) => String(t).trim()).filter(Boolean))];

export interface ZoneManualCountReport {
  zoneId: string;
  reports: ManualCountReport[];
  /** Guías pegadas que no aparecen en ninguna sucursal de la zona. */
  unlocated: DiagnosisRow[];
}

/**
 * Conteo manual de TODA una zona: se pega todo junto, cada guía se ubica en la sucursal donde
 * está registrada y se corre el conteo de cada sucursal con su parte (2 a la vez). Las sucursales
 * sin guías pegadas también se revisan: su "cobrado y no lo contó" cuenta.
 */
@Injectable()
export class ZoneManualCountService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly zone: ZoneService,
    private readonly manualCount: ManualCountService,
  ) {}

  async diagnose(zoneId: string, user: ZoneUser & { userId?: string }, day: string, lists: ManualLists, scope: ManualCountScope = 'day'): Promise<ZoneManualCountReport> {
    const subs = await this.zone.subsidiariesOf(zoneId, user);
    const subIds = subs.map((s) => s.id);
    const marks: [Mark, string[]][] = [['POD', clean(lists.pod)], ['07', clean(lists.dex07)], ['08', clean(lists.dex08)]];
    const recs = clean(lists.recolecciones);
    const all = [...new Set([...marks.flatMap(([, l]) => l), ...recs])];
    // Por semana, la guía se ubica con el registro vigente al cierre de la semana.
    const locateDay = scope === 'week' ? weekDaysOf(day)[6] : day;
    const { bySubsidiary, unlocated } = locateGuides(all, await this.candidates(all, subIds), subIds, locateDay);

    const pick = (list: string[], sub: string) => list.filter((tn) => bySubsidiary.get(sub)?.includes(tn));
    const settled = await runWithLimit(subs, 2, (s) =>
      this.manualCount.diagnose(
        s.id,
        day,
        { pod: pick(marks[0][1], s.id), dex07: pick(marks[1][1], s.id), dex08: pick(marks[2][1], s.id), recolecciones: pick(recs, s.id), sources: lists.sources },
        scope,
        user.userId ?? null,
      ),
    );
    const reports = settled.filter((r): r is PromiseFulfilledResult<ManualCountReport> => r.status === 'fulfilled').map((r) => r.value);
    const failed = settled.map((r, i) => (r.status === 'rejected' ? subs[i].name : null)).filter(Boolean);
    if (failed.length) throw new InternalServerErrorException(`No se pudo revisar: ${failed.join(', ')}. Intenta de nuevo.`);

    const markOf = new Map<string, Mark>();
    for (const [m, l] of marks) for (const tn of l) markOf.set(tn, m);
    const ctx = { day, subsidiaryId: '', expectedCost: 0, isChargeable: () => true };
    const missing = unlocated
      .filter((tn) => markOf.has(tn))
      .map((tn) => ({ ...diagnoseGuide(markOf.get(tn)!, emptyFacts(tn), ctx), day }));
    return { zoneId, reports, unlocated: missing };
  }

  /** Dónde está registrada cada guía pegada (solo sucursales de la zona). */
  private async candidates(tns: string[], subIds: string[]): Promise<GuideCandidate[]> {
    if (!tns.length || !subIds.length) return [];
    const t = inList(tns.length);
    const s = inList(subIds.length);
    const rows: any[] = await this.dataSource.query(
      `SELECT sh.trackingNumber AS tn, sh.subsidiaryId, 'shipment' AS kind, sh.createdAt, DATE(c.date) AS consDay
         FROM shipment sh LEFT JOIN consolidated c ON c.id = sh.consolidatedId
        WHERE sh.active = 1 AND sh.trackingNumber IN (${t}) AND sh.subsidiaryId IN (${s})
       UNION ALL
       SELECT cs.trackingNumber, cs.subsidiaryId, 'charge', cs.createdAt, DATE(ch.chargeDate)
         FROM charge_shipment cs LEFT JOIN charge ch ON ch.id = cs.chargeId
        WHERE cs.active = 1 AND cs.trackingNumber IN (${t}) AND cs.subsidiaryId IN (${s})
       UNION ALL
       SELECT co.trackingNumber, co.subsidiaryId, 'collection', co.createdAt, NULL
         FROM collection co WHERE co.trackingNumber IN (${t}) AND co.subsidiaryId IN (${s})
       UNION ALL
       SELECT n.trackingNumber, n.subsidiaryId, 'novan', n.createdAt, pd.routeDate
         FROM shipment_not_in_files n LEFT JOIN package_dispatch pd ON pd.id = n.dispatchId
        WHERE n.trackingNumber IN (${t}) AND n.subsidiaryId IN (${s})`,
      [...tns, ...subIds, ...tns, ...subIds, ...tns, ...subIds, ...tns, ...subIds],
    );
    return rows.map((r) => ({ tn: String(r.tn), subsidiaryId: String(r.subsidiaryId), kind: r.kind, createdAt: r.createdAt, consDay: sqlDay(r.consDay) }));
  }
}

function emptyFacts(tn: string): GuideFacts {
  return {
    trackingNumber: tn, kind: null, subsidiaryId: null, transferredIn: false, consolidado: null, routes: [],
    systemStatus: null, systemOutcome: null, systemDex08Dates: [], fedex: null, incomes: [], returned: false, warehouseDelivered: false,
  };
}
