import type { ChargeGuideInput, ChargeGuideRow, PackageIncome, ShipmentTwin } from '../zone/zone.types';

/** Resta días a un YYYY-MM-DD (en UTC, sin horas). */
function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Marca las guías de carga que TAMBIÉN están como paquete (consolidado de la misma semana o la
 * anterior) y si ese paquete tiene cobro activo (= se cobró de más). El cobro del paquete se liga
 * por `shipmentId`; si el ingreso no lo trae (ingresos del 19-oct), por guía.
 */
export function detectChargeDoubles(
  guides: ChargeGuideInput[],
  twins: ShipmentTwin[],
  incomes: PackageIncome[],
  week: { from: string; to: string },
): ChargeGuideRow[] {
  const windowFrom = minusDays(week.from, 7);
  const twinsByTn = new Map<string, ShipmentTwin[]>();
  for (const t of twins) {
    if (!t.consDay || t.consDay < windowFrom || t.consDay > week.to) continue;
    twinsByTn.set(t.trackingNumber, [...(twinsByTn.get(t.trackingNumber) ?? []), t]);
  }
  return guides.map((g) => {
    const twin = (twinsByTn.get(g.trackingNumber) ?? []).sort((a, b) => b.consDay!.localeCompare(a.consDay!))[0] ?? null;
    const packageIncome = twin
      ? incomes.find((i) => i.shipmentId === twin.shipmentId) ??
        incomes.find((i) => i.shipmentId === null && i.trackingNumber === g.trackingNumber) ??
        null
      : null;
    return { ...g, twin, packageIncome, isDouble: !!twin, overcharged: !!packageIncome };
  });
}
