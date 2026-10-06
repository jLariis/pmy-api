import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConsolidatedFamily, SubsidiaryTariff } from './consolidated-actions.types';

const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const num = (v: unknown) => Number(v ?? 0) || 0;
const bool = (v: unknown) => v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
const boolOrNull = (v: unknown) => (v === null || v === undefined ? null : bool(v));

/** Llave de la familia: CONSNUMBER|sucursal. Una solicitud pendiente por familia. */
export function familyKey(consNumber: string, subsidiaryId: string): string {
  return `${norm(consNumber)}|${subsidiaryId}`;
}

/**
 * Carga la FAMILIA de un consolidado: todas las filas `consolidated` con el mismo consNumber
 * (normalizado) y la misma sucursal (master + F2 son filas distintas), más sus guías, guías de
 * carga, cargas, ingresos y devoluciones. Solo trae lo que sigue ACTIVO (lo ya dado de baja no se
 * vuelve a tocar), pero los ingresos se buscan por TODAS las guías/cargas de la familia: así un
 * borrado que dejó ingresos vivos (caso 305821198046) se puede completar.
 */
@Injectable()
export class ConsolidatedFamilyLoader {
  constructor(private readonly dataSource: DataSource) {}

  private m(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }

  async load(targetId: string, manager?: EntityManager): Promise<ConsolidatedFamily> {
    const q = this.m(manager);
    const [target] = await q.query('SELECT id, consNumber, subsidiaryId FROM consolidated WHERE id = ?', [targetId]);
    if (!target) throw new NotFoundException('Consolidado no encontrado.');
    const subsidiaryId: string = target.subsidiaryId;
    const consNumber: string = String(target.consNumber ?? '').trim();

    const consRows: any[] = await q.query(
      'SELECT id, consNumber, subsidiaryId, date, active FROM consolidated WHERE subsidiaryId = ? AND TRIM(UPPER(consNumber)) = ?',
      [subsidiaryId, norm(consNumber)],
    );
    const consIds = consRows.map((r) => r.id);

    const shipRows: any[] = consIds.length
      ? await q.query(
          'SELECT id, trackingNumber, subsidiaryId, shipmentType, active, status FROM shipment WHERE consolidatedId IN (?)',
          [consIds],
        )
      : [];
    const csRows: any[] = consIds.length
      ? await q.query(
          'SELECT id, trackingNumber, subsidiaryId, chargeId, active, status FROM charge_shipment WHERE consolidatedId IN (?)',
          [consIds],
        )
      : [];
    const chargeIdsFromCs = [...new Set(csRows.map((r) => r.chargeId).filter(Boolean))];
    const chargeRows: any[] = await q.query(
      `SELECT id, subsidiaryId, chargeDate, isHalfTon, active FROM charge
        WHERE (subsidiaryId = ? AND TRIM(UPPER(consNumber)) = ?)${chargeIdsFromCs.length ? ' OR id IN (?)' : ''}`,
      chargeIdsFromCs.length ? [subsidiaryId, norm(consNumber), chargeIdsFromCs] : [subsidiaryId, norm(consNumber)],
    );

    const shipIds = shipRows.map((r) => r.id);
    const chargeIds = chargeRows.map((r) => r.id);
    const incomeRows: any[] =
      shipIds.length || chargeIds.length
        ? await q.query(
            `SELECT id, trackingNumber, subsidiaryId, sourceType, shipmentId, chargeId, cost, originalCost, date,
                    shipmentType, secondAbordApplied, chargeNotChargedSameDay
               FROM income
              WHERE active = 1 AND (${[shipIds.length ? 'shipmentId IN (?)' : null, chargeIds.length ? 'chargeId IN (?)' : null]
                .filter(Boolean)
                .join(' OR ')})`,
            [...(shipIds.length ? [shipIds] : []), ...(chargeIds.length ? [chargeIds] : [])],
          )
        : [];
    const devRows: any[] = consIds.length
      ? await q.query('SELECT id, trackingNumber, subsidiaryId FROM devolution WHERE consolidatedId IN (?)', [consIds])
      : [];

    const activeShip = shipRows.filter((r) => bool(r.active));
    const activeCs = csRows.filter((r) => bool(r.active));
    const routed: any[] =
      activeShip.length || activeCs.length
        ? await q.query(
            `SELECT COUNT(DISTINCT COALESCE(shipmentId, chargeShipmentId)) n FROM package_dispatch_history
              WHERE ${[activeShip.length ? 'shipmentId IN (?)' : null, activeCs.length ? 'chargeShipmentId IN (?)' : null]
                .filter(Boolean)
                .join(' OR ')}`,
            [...(activeShip.length ? [activeShip.map((r) => r.id)] : []), ...(activeCs.length ? [activeCs.map((r) => r.id)] : [])],
          )
        : [{ n: 0 }];

    return {
      consNumber,
      subsidiaryId,
      consolidated: consRows
        .filter((r) => bool(r.active))
        .map((r) => ({ id: r.id, consNumber: r.consNumber, subsidiaryId: r.subsidiaryId, date: new Date(r.date) })),
      shipments: activeShip.map((r) => ({ id: r.id, trackingNumber: r.trackingNumber, subsidiaryId: r.subsidiaryId, shipmentType: r.shipmentType })),
      chargeShipments: activeCs.map((r) => ({ id: r.id, trackingNumber: r.trackingNumber, subsidiaryId: r.subsidiaryId })),
      charges: chargeRows
        .filter((r) => bool(r.active))
        .map((r) => ({ id: r.id, subsidiaryId: r.subsidiaryId, chargeDate: new Date(r.chargeDate), isHalfTon: bool(r.isHalfTon) })),
      incomes: incomeRows.map((r) => ({
        id: r.id,
        trackingNumber: r.trackingNumber ?? null,
        subsidiaryId: r.subsidiaryId ?? null,
        sourceType: r.sourceType,
        shipmentId: r.shipmentId ?? null,
        chargeId: r.chargeId ?? null,
        cost: num(r.cost),
        originalCost: r.originalCost == null ? null : num(r.originalCost),
        date: new Date(r.date),
        shipmentType: r.shipmentType ?? null,
        secondAbordApplied: boolOrNull(r.secondAbordApplied),
        chargeNotChargedSameDay: bool(r.chargeNotChargedSameDay),
      })),
      devolutions: devRows.map((r) => ({ id: r.id, trackingNumber: r.trackingNumber, subsidiaryId: r.subsidiaryId ?? null })),
      enRuta: [...activeShip, ...activeCs].filter((r) => String(r.status).toLowerCase() === 'en_ruta').length,
      withRoute: num(routed[0]?.n),
    };
  }

  /** ¿La familia tiene algo vivo que cambiar? */
  static isEmpty(f: ConsolidatedFamily): boolean {
    return !f.consolidated.length && !f.shipments.length && !f.chargeShipments.length && !f.charges.length && !f.incomes.length;
  }

  /** ¿Existe en `subsidiaryId` otra familia ACTIVA con este consNumber? (destino duplicado). */
  async activeFamilyExists(consNumber: string, subsidiaryId: string, manager?: EntityManager): Promise<boolean> {
    const rows = await this.m(manager).query(
      'SELECT 1 FROM consolidated WHERE subsidiaryId = ? AND TRIM(UPPER(consNumber)) = ? AND active = 1 LIMIT 1',
      [subsidiaryId, norm(consNumber)],
    );
    return rows.length > 0;
  }

  async loadTariff(subsidiaryId: string, manager?: EntityManager): Promise<SubsidiaryTariff> {
    const [s] = await this.m(manager).query(
      `SELECT id, name, active, fedexCostPackage, dhlCostPackage, chargeCost, chargeCostHalfTon, chargeCostSundayHoliday,
              chargeCostHalfTonSundayHoliday, chargeSecondAbord, secondAbordAmount, chargeOnlyFirstOfDay
         FROM subsidiary WHERE id = ?`,
      [subsidiaryId],
    );
    if (!s) throw new BadRequestException('La sucursal no existe.');
    return {
      id: s.id,
      name: s.name,
      fedexCostPackage: num(s.fedexCostPackage),
      dhlCostPackage: num(s.dhlCostPackage),
      chargeCost: num(s.chargeCost),
      chargeCostHalfTon: num(s.chargeCostHalfTon),
      chargeCostSundayHoliday: num(s.chargeCostSundayHoliday),
      chargeCostHalfTonSundayHoliday: num(s.chargeCostHalfTonSundayHoliday),
      chargeSecondAbord: bool(s.chargeSecondAbord),
      secondAbordAmount: num(s.secondAbordAmount),
      chargeOnlyFirstOfDay: bool(s.chargeOnlyFirstOfDay),
    };
  }

  async isSubsidiaryActive(subsidiaryId: string, manager?: EntityManager): Promise<boolean> {
    const [s] = await this.m(manager).query('SELECT active FROM subsidiary WHERE id = ?', [subsidiaryId]);
    return !!s && bool(s.active);
  }

  /**
   * ¿Ya hay OTRA carga cobrada (cost>0, activa) en `subsidiaryId` el día `day` (fuera de esta
   * familia)? Para la regla "solo la primera carga del día".
   */
  async otherChargeIncomeOnDay(subsidiaryId: string, day: string, excludeChargeIds: string[], manager?: EntityManager): Promise<boolean> {
    const start = `${day} 00:00:00`;
    const params: any[] = [subsidiaryId, start, start];
    let extra = '';
    if (excludeChargeIds.length) { extra = ' AND (chargeId IS NULL OR chargeId NOT IN (?))'; params.push(excludeChargeIds); }
    const rows = await this.m(manager).query(
      `SELECT 1 FROM income WHERE subsidiaryId = ? AND sourceType = 'charge' AND active = 1 AND cost > 0
          AND date >= ? AND date < DATE_ADD(?, INTERVAL 1 DAY)${extra} LIMIT 1`,
      params,
    );
    return rows.length > 0;
  }
}
