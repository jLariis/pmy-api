import { chargeSecondAbordApplied, resolveChargeCost } from 'src/shipments/charge-cost';
import { deriveRepairIncome } from 'src/consolidador/logic/repair-income.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ActionPlan, ChangeEntity, ConsolidatedFamily, FamilyIncome, FieldChange, InsertTable, PlanSummary, RowInsert, SubsidiaryTariff } from './consolidated-actions.types';
import { dayOnlyUtc } from './consolidated-actions.plan';

/**
 * Plan PURO del cambio de tipo de un consolidado (paquete ↔ carga), completo o por guías.
 * Nunca borra ni copia historial: el registro original queda inactivo y nace uno nuevo en la otra
 * tabla con su estatus actual y UNA línea "Cambio de tipo". Lo aplica `ConsolidatedActionsExecutor`.
 * Spec: docs/superpowers/specs/2026-10-07-consolidado-cambiar-tipo-design.md
 */

export type PackageTable = 'shipment' | 'charge_shipment';
export type TargetType = 'carga' | 'paquete';

/** Columnas que se copian tal cual entre `shipment` y `charge_shipment`. */
export const COPY_COLUMNS = [
  'trackingNumber', 'shipmentType', 'recipientName', 'recipientAddress', 'recipientCity', 'recipientZip',
  'commitDateTime', 'recipientPhone', 'status', 'priority', 'receivedByName', 'subsidiaryId', 'isHighValue',
  'routeId', 'unloadingId', 'fedexUniqueId', 'carrierCode',
] as const;

export interface TypePackage {
  id: string;
  trackingNumber: string;
  /** Fila completa del registro original (al menos COPY_COLUMNS). */
  row: Record<string, unknown>;
  /** Último evento del historial (estatus actual y cuándo). */
  lastEvent: { status: string; exceptionCode: string | null; timestamp: Date } | null;
  /** Pago COD ligado (si tiene). */
  paymentId: string | null;
}

export interface TypeConsolidated {
  id: string;
  consNumber: string;
  subsidiaryId: string;
  date: Date;
  type: string;
  carrier?: string | null;
  /** Qué trae hoy la fila (el campo `type` NO distingue la F2: la subida F2 crea 'ordinario'). */
  kind?: 'paquete' | 'carga' | null;
}

export interface ChangeTypeInput {
  family: ConsolidatedFamily;
  /** Filas `consolidated` activas de la familia, con su tipo. */
  familyConsolidated: TypeConsolidated[];
  toType: TargetType;
  /** Guías a cambiar (todas las de la tabla origen si es completo). */
  packages: TypePackage[];
  whole: boolean;
  /** Consolidado destino: el elegido, el de la misma familia con el tipo correcto, o null (se crea). */
  destConsolidated: TypeConsolidated | null;
  /** Número para el consolidado/carga que se crea (p. ej. el de la F2 del correo). Por defecto, el del origen. */
  destConsNumber?: string | null;
  /** Carga activa del destino (solo a carga). null → se crea con su ingreso. */
  destChargeId: string | null;
  /** Guías que YA están activas en la tabla destino de ese consolidado → id del registro (se quita el duplicado). */
  alreadyInDest: Map<string, string>;
  tariff: SubsidiaryTariff;
  isHalfTon: boolean;
  isSundayHoliday: boolean;
  otherChargeIncomeOnDay: boolean;
  userId: string | null;
  now: Date;
  newId: () => string;
}

const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
};


class Builder {
  readonly changes: FieldChange[] = [];
  readonly inserts: RowInsert[] = [];
  set(entityType: ChangeEntity, entityId: string, trackingNumber: string | null, field: string, oldValue: unknown, value: unknown) {
    if (str(oldValue) === str(value)) return;
    this.changes.push({ entityType, entityId, trackingNumber, field, oldValue: str(oldValue), newValue: str(value), value });
  }
  insert(table: InsertTable, id: string, trackingNumber: string | null, values: Record<string, unknown>) {
    this.inserts.push({ table, id, trackingNumber, values: { id, ...values } });
  }
}

function emptySummary(f: ConsolidatedFamily): PlanSummary {
  const amountBefore = round2(f.incomes.reduce((s, i) => s + Number(i.cost || 0), 0));
  return {
    consolidated: 0, shipments: 0, chargeShipments: 0, charges: 0, devolutions: 0,
    incomesAnnulled: 0, incomesMoved: 0, incomesRecosted: 0, incomesRedated: 0,
    converted: 0, incomesCreated: 0, amountBefore, amountAfter: amountBefore,
  };
}

function packageCost(t: SubsidiaryTariff, shipmentType: unknown): number {
  return round2(String(shipmentType ?? '').toLowerCase() === 'dhl' ? t.dhlCostPackage : t.fedexCostPackage);
}

/** Cambio de tipo. Devuelve el plan con UPDATE (`changes`) e INSERT (`inserts`). */
export function planChangeType(input: ChangeTypeInput): ActionPlan {
  const { family: f, toType, tariff, now, newId } = input;
  const b = new Builder();
  const summary = emptySummary(f);
  const warnings: string[] = [];
  const fromTable: PackageTable = toType === 'carga' ? 'shipment' : 'charge_shipment';
  const toTable: PackageTable = toType === 'carga' ? 'charge_shipment' : 'shipment';
  const fromLabel = toType === 'carga' ? 'paquete' : 'carga';
  let amount = summary.amountBefore;

  // 1) Consolidado destino (se crea si no hay uno con el tipo correcto).
  let dest = input.destConsolidated;
  const base = input.familyConsolidated[0];
  // Completo: las guías se quedan en la misma fila (cambia la tabla, no el consolidado).
  if (input.whole) {
    dest = dest ?? base;
  } else if (!dest) {
    // Igual que la subida F2: fila nueva 'ordinario' con el mismo número (el tipo no distingue la F2).
    const id = newId();
    const consNumber = input.destConsNumber?.trim() || base.consNumber;
    dest = { id, consNumber, subsidiaryId: base.subsidiaryId, date: base.date, type: 'ordinario', kind: toType };
    b.insert('consolidated', id, null, {
      date: base.date, type: 'ordinario', numberOfPackages: 0, isCompleted: 0, consNumber,
      createdAt: now, subsidiaryId: base.subsidiaryId, createdById: input.userId, carrier: base.carrier ?? 'fedex', active: 1,
    });
    summary.consolidated++;
  }

  // 2) Carga destino (solo a carga): la existente o una nueva con su ingreso.
  let chargeId = input.destChargeId;
  if (toType === 'carga' && !chargeId) {
    chargeId = newId();
    const day = dest!.date.toISOString().slice(0, 10);
    b.insert('charge', chargeId, null, {
      chargeDate: dayOnlyUtc(day), numberOfPackages: 0, isChargeComplete: 0, createdAt: now, consNumber: dest!.consNumber,
      subsidiaryId: dest!.subsidiaryId, createdById: input.userId, isHalfTon: input.isHalfTon ? 1 : 0, active: 1,
    });
    summary.charges++;
    const skip = !!tariff.chargeOnlyFirstOfDay && input.otherChargeIncomeOnDay;
    const cost = skip ? 0 : round2(resolveChargeCost(tariff, input.isHalfTon, input.isSundayHoliday));
    const incomeId = newId();
    b.insert('income', incomeId, null, {
      trackingNumber: null, shipmentType: 'fedex', cost, incomeType: 'entregado', isGrouped: 1, sourceType: 'charge',
      date: dayOnlyUtc(day), createdAt: now, subsidiaryId: dest!.subsidiaryId, chargeId, createdById: input.userId, active: 1,
      secondAbordApplied: skip ? 0 : chargeSecondAbordApplied(tariff, input.isHalfTon, input.isSundayHoliday) ? 1 : 0,
      chargeNotChargedSameDay: skip ? 1 : 0,
    });
    summary.incomesCreated!++;
    amount += cost;
    if (skip) warnings.push('La sucursal solo cobra la primera carga del día y ese día ya hay otra: la carga nueva queda en $0.');
    else if (cost <= 0) warnings.push(`La sucursal ${tariff.name} no tiene tarifa de carga: la carga nueva queda en $0 y los ingresos por paquete de estas guías se pierden.`);
  }

  // 3) A paquete y completo: la carga y su ingreso se dan de baja (cobraba por todo el consolidado).
  if (toType === 'paquete' && input.whole) {
    for (const c of f.charges) { b.set('charge', c.id, null, 'active', true, false); summary.charges++; }
    for (const i of f.incomes.filter((x) => x.sourceType === 'charge')) {
      b.set('income', i.id, i.trackingNumber, 'active', true, false);
      summary.incomesAnnulled++;
      amount -= Number(i.cost || 0);
    }
  }

  // 4) Guías: baja del original + registro nuevo en la otra tabla (o el que ya existía).
  const incomesByPackage = new Map<string, FamilyIncome[]>();
  for (const i of f.incomes) {
    if (i.sourceType !== 'shipment' || !i.shipmentId) continue;
    incomesByPackage.set(i.shipmentId, [...(incomesByPackage.get(i.shipmentId) ?? []), i]);
  }
  let moved = 0;
  let enRuta = 0;
  let noTariff = false;
  let duplicates = 0;
  for (const p of input.packages) {
    // La guía YA está activa en la tabla destino de ese consolidado (p. ej. la F2 que FedEx repite en
    // el master): no se crea otro registro; solo se da de baja el duplicado y se anulan sus ingresos.
    const existingId = input.alreadyInDest.get(p.trackingNumber) ?? null;
    const nid = existingId ?? newId();
    const status = String(p.lastEvent?.status ?? p.row.status ?? ShipmentStatusType.PENDIENTE);
    const ts = p.lastEvent?.timestamp ?? now;
    const shipmentType = p.row.shipmentType ?? 'fedex';
    const subsidiaryId = (p.row.subsidiaryId as string | null) ?? f.subsidiaryId;

    if (existingId) {
      duplicates++;
    } else {
      const values: Record<string, unknown> = {};
      for (const c of COPY_COLUMNS) values[c] = p.row[c] ?? null;
      Object.assign(values, {
        status, consNumber: dest!.consNumber, consolidatedId: dest!.id, createdAt: now, createdById: input.userId, active: 1,
      });
      if (toTable === 'charge_shipment') {
        values.chargeId = chargeId;
        values.exceptionCode = p.lastEvent?.exceptionCode ?? '';
      } else {
        values.paymentId = p.paymentId;
        values.dhlUniqueId = null;
      }
      b.insert(toTable, nid, p.trackingNumber, values);
      moved++;

      b.insert('shipment_status', newId(), p.trackingNumber, {
        status, exceptionCode: p.lastEvent?.exceptionCode ?? null, timestamp: ts, createdAt: now,
        notes: `Cambio de tipo: venía como ${fromLabel} (consolidado ${f.consNumber}).`,
        shipmentId: toTable === 'shipment' ? nid : null, chargeShipmentId: toTable === 'charge_shipment' ? nid : null,
      });

      if (values.routeId) {
        b.insert('package_dispatch_history', newId(), p.trackingNumber, {
          addedAt: now, dispatchId: values.routeId,
          shipmentId: toTable === 'shipment' ? nid : null, chargeShipmentId: toTable === 'charge_shipment' ? nid : null,
        });
        if (status === ShipmentStatusType.EN_RUTA) enRuta++;
      }
    }
    b.set(fromTable, p.id, p.trackingNumber, 'active', true, false);
    if (fromTable === 'shipment') summary.shipments++; else summary.chargeShipments++;

    // Cobro COD: se mueve al registro que queda (no se copia).
    if (p.paymentId) {
      if (toTable === 'charge_shipment') {
        b.set('payment', p.paymentId, p.trackingNumber, 'shipmentId', p.id, null);
        b.set('payment', p.paymentId, p.trackingNumber, 'chargeShipmentId', null, nid);
        b.set('shipment', p.id, p.trackingNumber, 'paymentId', p.paymentId, null);
      } else {
        b.set('payment', p.paymentId, p.trackingNumber, 'chargeShipmentId', p.id, null);
        b.set('payment', p.paymentId, p.trackingNumber, 'shipmentId', null, nid);
        if (existingId) b.set('shipment', existingId, p.trackingNumber, 'paymentId', null, p.paymentId);
      }
    }

    if (toType === 'carga') {
      // Los ingresos por paquete se anulan: la carga cobra plano.
      for (const i of incomesByPackage.get(p.id) ?? []) {
        b.set('income', i.id, i.trackingNumber, 'active', true, false);
        summary.incomesAnnulled++;
        amount -= Number(i.cost || 0);
      }
    } else if (!existingId) {
      // Paquete con estatus cobrable → su ingreso por paquete, fechado al último evento.
      const { create, incomeType } = deriveRepairIncome(status as ShipmentStatusType);
      if (create && incomeType) {
        const cost = packageCost(tariff, shipmentType);
        if (cost <= 0) noTariff = true;
        b.insert('income', newId(), p.trackingNumber, {
          trackingNumber: p.trackingNumber, shipmentType, cost, incomeType,
          nonDeliveryStatus: incomeType === 'entregado' ? null : p.lastEvent?.exceptionCode ?? null, isGrouped: 0,
          sourceType: 'shipment', date: ts, createdAt: now, subsidiaryId,
          shipmentId: nid, createdById: input.userId, active: 1, chargeNotChargedSameDay: 0,
        });
        summary.incomesCreated!++;
        amount += cost;
      }
    }
  }
  if (duplicates) {
    warnings.push(`${duplicates} guía(s) ya estaban como ${toType} en ${dest!.consNumber}: solo se quita el registro repetido como ${fromLabel}.`);
  }
  summary.converted = moved;

  // 5) Conteos al mover solo algunas guías (completo: el total no cambia).
  if (!input.whole && moved > 0) {
    warnings.push(`Se pasan ${moved} guía(s) de ${f.consNumber} al consolidado ${dest!.consNumber} como ${toType}.`);
  }
  if (enRuta) warnings.push(`${enRuta} guía(s) están en ruta: el registro nuevo queda en la misma salida.`);
  if (noTariff) warnings.push(`La sucursal ${tariff.name} no tiene tarifa por paquete; los ingresos nuevos quedarán en $0.`);
  if (f.withRoute > 0) warnings.push(`${f.withRoute} guía(s) ya salieron a ruta; sus salidas y cierres se quedan como pasaron.`);

  summary.amountAfter = round2(amount);
  return { changes: b.changes, inserts: b.inserts, summary, warnings };
}
