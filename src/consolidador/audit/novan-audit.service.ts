import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toHermosilloDateString } from 'src/common/utils';
import { noVanOutcomeFromTrack } from 'src/routeclosure/novan-income.util';
import { classifyNoVan, noVanFedexLabel } from '../logic/novan-audit.util';
import { sqlDay } from '../logic/sql-day.util';
import { ManualCountService } from './manual-count.service';
import type { NoVanReport, NoVanRow } from '../zone/zone.types';

const inList = (n: number) => Array(n).fill('?').join(',');
const shiftDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * 86400000);

/**
 * No VAN de la semana (shipment_not_in_files): guías que el chofer reportó en el cierre y que no
 * existen como paquete. Ruta, chofer, si es 31.5, su cobro y lo que dice FedEx (si ya está en caché).
 * Solo lectura.
 */
@Injectable()
export class NoVanAuditService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly manualCount: ManualCountService,
  ) {}

  async report(subsidiaryId: string, from: string, to: string): Promise<NoVanReport> {
    const [subRow] = await this.dataSource.query(`SELECT fedexCostPackage FROM subsidiary WHERE id = ? LIMIT 1`, [subsidiaryId]);
    const expectedCost = Number(subRow?.fedexCostPackage ?? 0);

    // Día = fecha de la ruta; si falta, el día Hermosillo del cierre (o del registro).
    const raw: any[] = await this.dataSource.query(
      `SELECT n.trackingNumber AS tn, pd.trackingNumber AS folio, pd.routeDate, pd.is315,
              COALESCE(rc.closeDate, rc.createdAt, n.createdAt) AS closedAt,
              (SELECT GROUP_CONCAT(d.name SEPARATOR ', ') FROM package_dispatch_drivers pdd JOIN driver d ON d.id = pdd.driverId WHERE pdd.dispatchId = pd.id) AS driver
         FROM shipment_not_in_files n
         LEFT JOIN package_dispatch pd ON pd.id = n.dispatchId
         LEFT JOIN route_closure rc ON rc.id = n.routeClosureId
        WHERE n.subsidiaryId = ? AND n.createdAt >= ? AND n.createdAt < ?`,
      // El registro nace al cerrar la ruta: se acota a la semana ± 14 días y luego se filtra por el día de la ruta.
      [subsidiaryId, shiftDays(from, -14), shiftDays(to, 15)],
    );
    const inWeek = raw
      .map((r) => ({ ...r, day: sqlDay(r.routeDate) ?? toHermosilloDateString(new Date(r.closedAt)) }))
      .filter((r) => r.day >= from && r.day <= to);
    // Una guía puede reportarse en varios cierres: se queda el último.
    const byTn = new Map<string, any>();
    for (const r of inWeek) {
      const prev = byTn.get(String(r.tn));
      if (!prev || String(r.day) >= String(prev.day)) byTn.set(String(r.tn), r);
    }
    const tns = [...byTn.keys()];
    if (!tns.length) return { rows: [], totals: { total: 0, charged: 0, withoutCharge: 0 }, expectedCost };

    const ph = inList(tns.length);
    const [incRows, shipRows] = await Promise.all([
      this.dataSource.query(
        `SELECT id, trackingNumber AS tn FROM income WHERE active = 1 AND sourceType = 'shipment' AND subsidiaryId = ? AND trackingNumber IN (${ph})`,
        [subsidiaryId, ...tns],
      ),
      this.dataSource.query(`SELECT DISTINCT trackingNumber AS tn FROM shipment WHERE active = 1 AND subsidiaryId = ? AND trackingNumber IN (${ph})`, [subsidiaryId, ...tns]),
    ]);
    const incomesByTn = new Map<string, string[]>();
    for (const i of incRows) incomesByTn.set(String(i.tn), [...(incomesByTn.get(String(i.tn)) ?? []), String(i.id)]);
    const asShipment = new Set(shipRows.map((s: any) => String(s.tn)));

    const rows: NoVanRow[] = tns.map((tn) => {
      const r = byTn.get(tn);
      const track = this.manualCount.cachedTrack(tn);
      const fedex = track ? noVanOutcomeFromTrack(tn, track) : null;
      const is315 = Number(r.is315) === 1;
      const incomeIds = incomesByTn.get(tn) ?? [];
      const { status, suggestedKind } = classifyNoVan({ is315, activeIncomes: incomeIds.length, existsAsShipment: asShipment.has(tn), fedex });
      return {
        trackingNumber: tn,
        routeDay: r.day,
        routeFolio: r.folio ?? null,
        driver: r.driver ?? null,
        closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
        is315,
        fedexLabel: noVanFedexLabel(fedex),
        status,
        suggestedKind,
        incomeIds,
      };
    });
    rows.sort((a, b) => String(a.routeDay).localeCompare(String(b.routeDay)) || a.trackingNumber.localeCompare(b.trackingNumber));
    return {
      rows,
      totals: {
        total: rows.length,
        charged: rows.filter((r) => r.status === 'cobrada').length,
        withoutCharge: rows.filter((r) => r.status === 'sin_cobro').length,
      },
      expectedCost,
    };
  }
}
