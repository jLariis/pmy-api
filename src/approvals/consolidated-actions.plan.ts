import { chargeSecondAbordApplied, resolveChargeCost } from 'src/shipments/charge-cost';
import {
  ActionPlan,
  ChangeEntity,
  ConsolidatedFamily,
  FamilyIncome,
  FieldChange,
  PlanSummary,
  SubsidiaryTariff,
} from './consolidated-actions.types';

/**
 * Plan PURO de las acciones sobre consolidado (borrar, cambiar sucursal, cambiar fecha): recibe la
 * familia ya cargada y devuelve la lista exacta de campos que cambian (antes → después) + un
 * resumen. Lo aplica `ConsolidatedActionsExecutor` en una sola transacción y cada cambio queda
 * en la bitácora. Spec: docs/superpowers/specs/2026-10-06-consolidado-acciones-design.md
 */

/** 'yyyy-MM-dd' → medianoche UTC (convención de los campos día-solo: consolidado, carga, ingreso de carga). */
export function dayOnlyUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
};

function emptySummary(f: ConsolidatedFamily): PlanSummary {
  const amountBefore = round2(f.incomes.reduce((s, i) => s + Number(i.cost || 0), 0));
  return {
    consolidated: 0, shipments: 0, chargeShipments: 0, charges: 0, devolutions: 0,
    incomesAnnulled: 0, incomesMoved: 0, incomesRecosted: 0, incomesRedated: 0,
    amountBefore, amountAfter: amountBefore,
  };
}

class PlanBuilder {
  readonly changes: FieldChange[] = [];
  set(entityType: ChangeEntity, entityId: string, trackingNumber: string | null, field: string, oldValue: unknown, value: unknown) {
    this.changes.push({ entityType, entityId, trackingNumber, field, oldValue: str(oldValue), newValue: str(value), value });
  }
}

function routeWarning(f: ConsolidatedFamily): string[] {
  const w: string[] = [];
  if (f.withRoute > 0) {
    w.push(`${f.withRoute} guía(s) ya salieron a ruta; sus salidas y cierres se quedan como pasaron.`);
  }
  if (f.enRuta > 0) w.push(`${f.enRuta} guía(s) están en ruta en este momento.`);
  return w;
}

/** BORRAR: baja lógica de toda la familia y anulación de sus ingresos. */
export function planDelete(f: ConsolidatedFamily): ActionPlan {
  const b = new PlanBuilder();
  const summary = emptySummary(f);
  for (const c of f.consolidated) { b.set('consolidated', c.id, null, 'active', true, false); summary.consolidated++; }
  for (const s of f.shipments) { b.set('shipment', s.id, s.trackingNumber, 'active', true, false); summary.shipments++; }
  for (const s of f.chargeShipments) { b.set('charge_shipment', s.id, s.trackingNumber, 'active', true, false); summary.chargeShipments++; }
  for (const c of f.charges) { b.set('charge', c.id, null, 'active', true, false); summary.charges++; }
  for (const i of f.incomes) { b.set('income', i.id, i.trackingNumber, 'active', true, false); summary.incomesAnnulled++; }
  summary.amountAfter = 0;
  return { changes: b.changes, summary, warnings: routeWarning(f) };
}

/** Costo de un ingreso de CARGA según la tarifa y el día (domingo/festivo) de la carga. */
function chargeIncomeCost(
  income: FamilyIncome,
  tariff: SubsidiaryTariff,
  isHalfTon: boolean,
  isSundayHoliday: boolean,
): { cost: number; secondAbord: boolean } {
  const override = income.secondAbordApplied ?? undefined;
  return {
    cost: round2(resolveChargeCost(tariff, isHalfTon, isSundayHoliday, override)),
    secondAbord: chargeSecondAbordApplied(tariff, isHalfTon, isSundayHoliday, override),
  };
}

/**
 * CAMBIAR SUCURSAL: todo pasa al destino (las guías traspasadas a otra sucursal se respetan) y los
 * ingresos se recalculan con la tarifa del destino. Los que no son de guía ni de carga solo
 * cambian de sucursal.
 */
export function planChangeSubsidiary(
  f: ConsolidatedFamily,
  dest: SubsidiaryTariff,
  isSundayHoliday: (day: string) => boolean,
): ActionPlan {
  const b = new PlanBuilder();
  const summary = emptySummary(f);
  const warnings = routeWarning(f);
  const origin = f.subsidiaryId;
  const to = dest.id;

  for (const c of f.consolidated) { b.set('consolidated', c.id, null, 'subsidiaryId', c.subsidiaryId, to); summary.consolidated++; }
  for (const s of f.shipments) {
    if (s.subsidiaryId !== origin) continue; // traspaso operativo a otra sucursal: se respeta
    b.set('shipment', s.id, s.trackingNumber, 'subsidiaryId', s.subsidiaryId, to); summary.shipments++;
  }
  for (const s of f.chargeShipments) {
    if (s.subsidiaryId !== origin) continue;
    b.set('charge_shipment', s.id, s.trackingNumber, 'subsidiaryId', s.subsidiaryId, to); summary.chargeShipments++;
  }
  for (const c of f.charges) { b.set('charge', c.id, null, 'subsidiaryId', c.subsidiaryId, to); summary.charges++; }
  for (const d of f.devolutions) {
    if (d.subsidiaryId === to) continue;
    b.set('devolution', d.id, d.trackingNumber, 'subsidiaryId', d.subsidiaryId, to); summary.devolutions++;
  }

  const chargeById = new Map(f.charges.map((c) => [c.id, c]));
  let noPackageTariff = false;
  let amountAfter = 0;
  for (const i of f.incomes) {
    const oldCost = round2(i.cost);
    let newCost = oldCost;
    if (i.subsidiaryId !== to) { b.set('income', i.id, i.trackingNumber, 'subsidiaryId', i.subsidiaryId, to); summary.incomesMoved++; }

    if (i.sourceType === 'shipment') {
      const isDhl = String(i.shipmentType ?? '').toLowerCase() === 'dhl';
      newCost = round2(isDhl ? dest.dhlCostPackage : dest.fedexCostPackage);
      if (newCost <= 0) noPackageTariff = true;
    } else if (i.sourceType === 'charge' && !i.chargeNotChargedSameDay) {
      const ch = i.chargeId ? chargeById.get(i.chargeId) : undefined;
      const day = (ch?.chargeDate ?? i.date).toISOString().slice(0, 10);
      const r = chargeIncomeCost(i, dest, !!ch?.isHalfTon, isSundayHoliday(day));
      newCost = r.cost;
      if (r.secondAbord !== (i.secondAbordApplied ?? null)) {
        b.set('income', i.id, i.trackingNumber, 'secondAbordApplied', i.secondAbordApplied, r.secondAbord);
      }
    }

    if (newCost !== oldCost) {
      if (i.originalCost == null) b.set('income', i.id, i.trackingNumber, 'originalCost', null, oldCost);
      b.set('income', i.id, i.trackingNumber, 'cost', oldCost, newCost);
      summary.incomesRecosted++;
    }
    amountAfter += newCost;
  }
  summary.amountAfter = round2(amountAfter);
  if (noPackageTariff) warnings.push(`La sucursal ${dest.name} no tiene tarifa por paquete; los ingresos quedarán en $0.`);
  return { changes: b.changes, summary, warnings };
}

/**
 * CAMBIAR FECHA: consolidado y cargas al día nuevo; el ingreso de cada carga se mueve y se
 * recalcula (domingo/festivo, "solo 1ra carga del día"). Los ingresos por paquete no cambian:
 * van con la fecha del evento de FedEx.
 */
export function planChangeDate(
  f: ConsolidatedFamily,
  tariff: SubsidiaryTariff,
  newDay: string,
  isSundayHoliday: boolean,
  otherChargeIncomeOnDay: boolean,
): ActionPlan {
  const b = new PlanBuilder();
  const summary = emptySummary(f);
  const target = dayOnlyUtc(newDay);

  for (const c of f.consolidated) { b.set('consolidated', c.id, null, 'date', c.date, target); summary.consolidated++; }
  for (const c of f.charges) { b.set('charge', c.id, null, 'chargeDate', c.chargeDate, target); summary.charges++; }

  const chargeById = new Map(f.charges.map((c) => [c.id, c]));
  const skip = !!tariff.chargeOnlyFirstOfDay && otherChargeIncomeOnDay;
  let amountAfter = 0;
  for (const i of f.incomes) {
    const oldCost = round2(i.cost);
    if (i.sourceType !== 'charge') { amountAfter += oldCost; continue; }

    b.set('income', i.id, i.trackingNumber, 'date', i.date, target);
    summary.incomesRedated++;

    const ch = i.chargeId ? chargeById.get(i.chargeId) : undefined;
    const r = skip ? { cost: 0, secondAbord: false } : chargeIncomeCost(i, tariff, !!ch?.isHalfTon, isSundayHoliday);
    if (r.cost !== oldCost) {
      if (i.originalCost == null) b.set('income', i.id, i.trackingNumber, 'originalCost', null, oldCost);
      b.set('income', i.id, i.trackingNumber, 'cost', oldCost, r.cost);
      summary.incomesRecosted++;
    }
    if (skip !== !!i.chargeNotChargedSameDay) {
      b.set('income', i.id, i.trackingNumber, 'chargeNotChargedSameDay', !!i.chargeNotChargedSameDay, skip);
    }
    amountAfter += r.cost;
  }
  summary.amountAfter = round2(amountAfter);
  return { changes: b.changes, summary, warnings: [] };
}
