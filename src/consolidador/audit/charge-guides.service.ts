import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { effectiveLocalDay } from 'src/common/income-window.util';
import { detectChargeDoubles } from '../logic/charge-doubles.util';
import type { ChargeGuideInput, ChargeGuidesReport, PackageIncome, ShipmentTwin } from '../zone/zone.types';

const inList = (n: number) => Array(n).fill('?').join(',');
const day = (v: any): string | null => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const iso = (v: any): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

/**
 * Guías de las cargas (F2 / 1.5 ton) de la semana y las que TAMBIÉN están como paquete: si el
 * paquete tiene cobro activo se cobró de más (la carga ya incluye la guía). Solo lectura.
 */
@Injectable()
export class ChargeGuidesService {
  constructor(private readonly dataSource: DataSource) {}

  async report(subsidiaryId: string, from: string, to: string): Promise<ChargeGuidesReport> {
    const raw: any[] = await this.dataSource.query(
      `SELECT cs.id AS csId, cs.trackingNumber AS tn, ch.id AS chargeId, ch.consNumber, DATE(ch.chargeDate) AS chargeDay,
              (SELECT f.createdAt FROM import_file f WHERE f.consNumber = ch.consNumber AND f.subsidiaryId = ch.subsidiaryId ORDER BY f.createdAt DESC LIMIT 1) AS uploadedAt,
              (SELECT f.uploadedByName FROM import_file f WHERE f.consNumber = ch.consNumber AND f.subsidiaryId = ch.subsidiaryId ORDER BY f.createdAt DESC LIMIT 1) AS uploadedBy
         FROM charge_shipment cs JOIN charge ch ON ch.id = cs.chargeId
        WHERE cs.active = 1 AND ch.subsidiaryId = ? AND DATE(ch.chargeDate) BETWEEN ? AND ?
        ORDER BY ch.chargeDate, ch.consNumber, cs.trackingNumber`,
      [subsidiaryId, from, to],
    );
    const guides: ChargeGuideInput[] = raw.map((r) => ({
      chargeShipmentId: String(r.csId),
      trackingNumber: String(r.tn),
      chargeId: String(r.chargeId),
      consNumber: r.consNumber ?? null,
      chargeDay: day(r.chargeDay)!,
      uploadedAt: iso(r.uploadedAt),
      uploadedBy: r.uploadedBy ?? null,
    }));

    const tns = [...new Set(guides.map((g) => g.trackingNumber))];
    let twins: ShipmentTwin[] = [];
    let incomes: PackageIncome[] = [];
    if (tns.length) {
      const ph = inList(tns.length);
      const ships: any[] = await this.dataSource.query(
        `SELECT s.id, s.trackingNumber AS tn, c.consNumber, DATE(c.date) AS consDay, s.createdAt
           FROM shipment s LEFT JOIN consolidated c ON c.id = s.consolidatedId
          WHERE s.active = 1 AND s.subsidiaryId = ? AND s.trackingNumber IN (${ph})`,
        [subsidiaryId, ...tns],
      );
      twins = ships.map((s) => ({
        shipmentId: String(s.id),
        trackingNumber: String(s.tn),
        consNumber: s.consNumber ?? null,
        consDay: day(s.consDay),
        createdAt: iso(s.createdAt)!,
      }));
      const inc: any[] = await this.dataSource.query(
        `SELECT i.id, i.trackingNumber AS tn, i.shipmentId, i.cost, i.date, i.sourceType
           FROM income i
          WHERE i.active = 1 AND i.sourceType = 'shipment' AND i.subsidiaryId = ? AND i.trackingNumber IN (${ph})`,
        [subsidiaryId, ...tns],
      );
      incomes = inc.map((i) => ({
        incomeId: String(i.id),
        trackingNumber: String(i.tn),
        shipmentId: i.shipmentId ? String(i.shipmentId) : null,
        cost: Number(i.cost ?? 0),
        day: effectiveLocalDay({ sourceType: i.sourceType, date: i.date }),
      }));
    }

    const rows = detectChargeDoubles(guides, twins, incomes, { from, to });
    const byCharge = new Map<string, ChargeGuidesReport['charges'][number]>();
    for (const r of rows) {
      const c = byCharge.get(r.chargeId) ?? {
        chargeId: r.chargeId, consNumber: r.consNumber, chargeDay: r.chargeDay,
        uploadedAt: r.uploadedAt, uploadedBy: r.uploadedBy, guides: 0, doubles: 0,
      };
      c.guides++;
      if (r.isDouble) c.doubles++;
      byCharge.set(r.chargeId, c);
    }
    const over = rows.filter((r) => r.overcharged);
    return {
      charges: [...byCharge.values()],
      rows,
      totals: {
        guides: rows.length,
        doubles: rows.filter((r) => r.isDouble).length,
        overcharged: over.length,
        overchargedAmount: over.reduce((s, r) => s + (r.packageIncome?.cost ?? 0), 0),
      },
    };
  }
}
