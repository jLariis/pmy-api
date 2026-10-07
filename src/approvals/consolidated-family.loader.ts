import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConsolidatedFamily, SubsidiaryTariff } from './consolidated-actions.types';
import { TargetType, TypeConsolidated, TypePackage } from './consolidated-type.plan';

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

  /**
   * Cambio de tipo: lo que el plan necesita además de la familia. Guías de la tabla ORIGEN (todas o
   * las elegidas) con fila completa, último evento y pago COD; consolidado y carga destino; y guías
   * que ya están en la tabla destino de ese consolidado.
   */
  async loadTypeDetails(
    f: ConsolidatedFamily,
    opts: { toType: TargetType; trackingNumbers?: string[] | null; targetConsolidatedId?: string | null; destConsNumber?: string | null },
    manager?: EntityManager,
  ): Promise<{
    familyConsolidated: TypeConsolidated[];
    packages: TypePackage[];
    missing: string[];
    destConsolidated: TypeConsolidated | null;
    destChargeId: string | null;
    alreadyInDest: Map<string, string>;
    familyIsHalfTon: boolean | null;
  }> {
    const q = this.m(manager);
    const toCons = (r: any): TypeConsolidated => ({
      id: r.id, consNumber: String(r.consNumber ?? '').trim(), subsidiaryId: r.subsidiaryId, date: new Date(r.date), type: r.type, carrier: r.carrier,
      kind: r.kind ?? null,
    });
    // Qué trae cada fila: el campo `type` no sirve (la subida F2 crea 'ordinario'), se ve por contenido.
    const kindSql = `CASE WHEN EXISTS (SELECT 1 FROM charge_shipment cs WHERE cs.consolidatedId = c.id AND cs.active = 1) THEN 'carga'
                          WHEN EXISTS (SELECT 1 FROM shipment s WHERE s.consolidatedId = c.id AND s.active = 1) THEN 'paquete' END`;
    const familyConsolidated: TypeConsolidated[] = f.consolidated.length
      ? (await q.query(`SELECT c.id, c.consNumber, c.subsidiaryId, c.date, c.type, c.carrier, ${kindSql} AS kind FROM consolidated c WHERE c.id IN (?) ORDER BY c.createdAt`, [f.consolidated.map((c) => c.id)])).map(toCons)
      : [];

    const fromTable = opts.toType === 'carga' ? 'shipment' : 'charge_shipment';
    const source = opts.toType === 'carga' ? f.shipments : f.chargeShipments;
    const wanted = opts.trackingNumbers?.length ? new Set(opts.trackingNumbers.map((t) => String(t).trim())) : null;
    const chosen = wanted ? source.filter((s) => wanted.has(String(s.trackingNumber).trim())) : source;
    const found = new Set(chosen.map((s) => String(s.trackingNumber).trim()));
    const missing = wanted ? [...wanted].filter((t) => !found.has(t)) : [];

    const ids = chosen.map((s) => s.id);
    const rows: any[] = ids.length ? await q.query(`SELECT * FROM \`${fromTable}\` WHERE id IN (?)`, [ids]) : [];
    const fk = fromTable === 'shipment' ? 'shipmentId' : 'chargeShipmentId';
    const events: any[] = ids.length
      ? await q.query(`SELECT ${fk} AS pid, status, exceptionCode, timestamp FROM shipment_status WHERE ${fk} IN (?) ORDER BY timestamp DESC, createdAt DESC`, [ids])
      : [];
    const last = new Map<string, any>();
    for (const e of events) if (!last.has(e.pid)) last.set(e.pid, e);
    const payments = new Map<string, string>();
    if (fromTable === 'charge_shipment' && ids.length) {
      for (const p of await q.query('SELECT id, chargeShipmentId FROM payment WHERE chargeShipmentId IN (?)', [ids])) payments.set(p.chargeShipmentId, p.id);
    }
    const packages: TypePackage[] = rows.map((r) => {
      const e = last.get(r.id);
      return {
        id: r.id,
        trackingNumber: String(r.trackingNumber).trim(),
        row: r,
        lastEvent: e ? { status: e.status, exceptionCode: e.exceptionCode ?? null, timestamp: new Date(e.timestamp) } : null,
        paymentId: fromTable === 'shipment' ? r.paymentId ?? null : payments.get(r.id) ?? null,
      };
    });

    // Destino: el elegido, o el de la familia con el tipo correcto.
    const kindOk = (c: TypeConsolidated) => c.kind === opts.toType || c.kind === null;
    let destConsolidated: TypeConsolidated | null = null;
    if (opts.targetConsolidatedId) {
      const [r] = await q.query(`SELECT c.id, c.consNumber, c.subsidiaryId, c.date, c.type, c.carrier, c.active, ${kindSql} AS kind FROM consolidated c WHERE c.id = ?`, [opts.targetConsolidatedId]);
      if (!r || !bool(r.active)) throw new BadRequestException('El consolidado destino no existe o está dado de baja.');
      if (r.subsidiaryId !== f.subsidiaryId) throw new BadRequestException('El consolidado destino es de otra sucursal.');
      destConsolidated = toCons(r);
      if (!kindOk(destConsolidated)) {
        throw new BadRequestException(`El consolidado destino no es de ${opts.toType === 'carga' ? 'carga (F2)' : 'paquetes'}.`);
      }
    } else if (opts.destConsNumber?.trim() && norm(opts.destConsNumber) !== norm(f.consNumber)) {
      // Número de la F2 del correo: si ya existe en la sucursal se usa ese consolidado; si no, se crea.
      const rows: any[] = await q.query(
        `SELECT c.id, c.consNumber, c.subsidiaryId, c.date, c.type, c.carrier, ${kindSql} AS kind FROM consolidated c
          WHERE c.subsidiaryId = ? AND c.active = 1 AND TRIM(UPPER(c.consNumber)) = ? ORDER BY c.createdAt`,
        [f.subsidiaryId, norm(opts.destConsNumber)],
      );
      destConsolidated = rows.map(toCons).find((c) => kindOk(c)) ?? null;
    } else {
      destConsolidated = familyConsolidated.find((c) => c.kind === opts.toType) ?? null;
    }

    let destChargeId: string | null = null;
    if (opts.toType === 'carga') {
      if (destConsolidated) {
        const [c] = await q.query(
          `SELECT id FROM charge WHERE active = 1 AND (id IN (SELECT chargeId FROM charge_shipment WHERE consolidatedId = ? AND chargeId IS NOT NULL)
              OR (subsidiaryId = ? AND TRIM(UPPER(consNumber)) = ?)) ORDER BY createdAt LIMIT 1`,
          [destConsolidated.id, destConsolidated.subsidiaryId, norm(destConsolidated.consNumber)],
        );
        destChargeId = c?.id ?? null;
      }
      if (!destChargeId && !opts.targetConsolidatedId) destChargeId = f.charges[0]?.id ?? null;
    }

    const alreadyInDest = new Map<string, string>();
    if (destConsolidated) {
      const toTable = opts.toType === 'carga' ? 'charge_shipment' : 'shipment';
      for (const r of await q.query(`SELECT id, trackingNumber FROM \`${toTable}\` WHERE consolidatedId = ? AND active = 1`, [destConsolidated.id])) {
        alreadyInDest.set(String(r.trackingNumber).trim(), r.id);
      }
    }
    return {
      familyConsolidated, packages, missing, destConsolidated, destChargeId, alreadyInDest,
      familyIsHalfTon: f.charges.length ? f.charges[0].isHalfTon : null,
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
