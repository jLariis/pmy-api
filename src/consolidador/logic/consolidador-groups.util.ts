import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import {
  ConsolidadorGroup,
  ConsolidadorGroupsResult,
  GroupInputRow,
} from '../consolidador.types';

/** "Entregado" = toda entrega (nuestra + FedEx). El resto cuenta como no entregado. */
const DELIVERED = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
]);

/**
 * Pliega las filas normalizadas de la semana en grupos (ruta o consolidado) con sus KPIs.
 * Puro y testeable — el caller ya resolvió `groupKey`/`groupLabel`/`groupDate` y el veredicto.
 *  - delivered/notDelivered: SOLO envíos (isShipment).
 *  - incomeAmount/Count: TODOS los ingresos del grupo (envíos + cargas + …).
 *  - anomalyCount: envíos con veredicto `level !== 'ok'`.
 *  - rows: SOLO envíos (el detalle de guías; cargas no tienen estatus ni veredicto útil).
 *  - chargeDiscrepancy: suma de descuadres de cobro por guía dentro del grupo.
 */
export function buildGroups(
  rows: GroupInputRow[],
  discrepancyByTracking: Map<string, number>,
): ConsolidadorGroupsResult {
  const byKey = new Map<string, ConsolidadorGroup>();

  const ensure = (r: GroupInputRow): ConsolidadorGroup => {
    let g = byKey.get(r.groupKey);
    if (!g) {
      g = {
        id: r.groupKey,
        label: r.groupLabel,
        date: r.groupDate,
        meta: { driver: r.driver, owner: r.owner, shipmentCount: 0 },
        kpis: { delivered: 0, notDelivered: 0, incomeAmount: 0, incomeCount: 0, chargeDiscrepancy: 0, anomalyCount: 0 },
        rows: [],
      };
      byKey.set(r.groupKey, g);
    }
    return g;
  };

  for (const r of rows) {
    const g = ensure(r);

    if (r.incomeId) {
      g.kpis.incomeAmount += r.cost;
      g.kpis.incomeCount += 1;
    }

    if (r.isShipment) {
      g.meta.shipmentCount += 1;
      if (r.status && DELIVERED.has(String(r.status))) g.kpis.delivered += 1;
      else g.kpis.notDelivered += 1;
      if (r.verdict.level !== 'ok') g.kpis.anomalyCount += 1;
      g.rows.push({
        tracking: r.tracking,
        shipmentId: r.shipmentId,
        status: r.status,
        income: r.incomeId ? { id: r.incomeId, cost: r.cost } : null,
        verdict: r.verdict,
      });
      if (r.tracking && discrepancyByTracking.has(r.tracking)) {
        g.kpis.chargeDiscrepancy += discrepancyByTracking.get(r.tracking) ?? 0;
      }
    } else if (r.tracking && discrepancyByTracking.has(r.tracking)) {
      g.kpis.chargeDiscrepancy += discrepancyByTracking.get(r.tracking) ?? 0;
    }
  }

  const groups = [...byKey.values()].sort(
    (a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
  );
  return { groups };
}
