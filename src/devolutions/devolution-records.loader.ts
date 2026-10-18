import { EntityManager } from 'typeorm';
import { DevolutionRecord, DevolutionRecordRoute } from './devolution-target.util';

const ymd = (v: any): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Registros VIVOS de una guía (paquetes y cargas) con lo que la persona necesita para elegir cuál
 * se devuelve: consolidado, sucursal, estatus, última salida a ruta (y si ya se cerró) e ingreso
 * "entregado". SQL directo: filtra `active = 1` a mano.
 */
export async function loadDevolutionRecords(manager: EntityManager, trackingNumber: string): Promise<DevolutionRecord[]> {
  const rows: any[] = await manager.query(
    `SELECT 'shipment' AS kind, s.id, s.status, s.createdAt, s.consolidatedId,
            COALESCE(c.consNumber, s.consNumber) AS consNumber, c.date AS consDate,
            s.subsidiaryId, sub.name AS subsidiaryName,
            s.recipientName, s.recipientAddress, s.recipientCity, s.recipientZip
       FROM shipment s
       LEFT JOIN consolidated c ON c.id = s.consolidatedId
       LEFT JOIN subsidiary sub ON sub.id = s.subsidiaryId
      WHERE s.trackingNumber = ? AND s.active = 1
     UNION ALL
     SELECT 'charge' AS kind, cs.id, cs.status, cs.createdAt, cs.consolidatedId,
            COALESCE(c.consNumber, cs.consNumber) AS consNumber, c.date AS consDate,
            cs.subsidiaryId, sub.name AS subsidiaryName,
            cs.recipientName, cs.recipientAddress, cs.recipientCity, cs.recipientZip
       FROM charge_shipment cs
       LEFT JOIN consolidated c ON c.id = cs.consolidatedId
       LEFT JOIN subsidiary sub ON sub.id = cs.subsidiaryId
      WHERE cs.trackingNumber = ? AND cs.active = 1`,
    [trackingNumber, trackingNumber],
  );
  if (!rows.length) return [];

  const shipmentIds = rows.filter((r) => r.kind === 'shipment').map((r) => r.id);
  const chargeIds = rows.filter((r) => r.kind === 'charge').map((r) => r.id);

  // Última salida a ruta (activa) de cada registro y si ya tiene cierre.
  const routes: any[] = await manager.query(
    `SELECT h.shipmentId, h.chargeShipmentId, pd.trackingNumber AS folio, pd.routeDate, pd.createdAt,
            (rc.id IS NOT NULL) AS closed
       FROM package_dispatch_history h
       JOIN package_dispatch pd ON pd.id = h.dispatchId AND pd.active = 1
       LEFT JOIN route_closure rc ON rc.package_dispatch_id = pd.id
      WHERE h.shipmentId IN (?) OR h.chargeShipmentId IN (?)`,
    [shipmentIds.length ? shipmentIds : [''], chargeIds.length ? chargeIds : ['']],
  );
  const lastRoute = new Map<string, { at: number; route: DevolutionRecordRoute }>();
  for (const r of routes) {
    const key = r.shipmentId ? `shipment:${r.shipmentId}` : `charge:${r.chargeShipmentId}`;
    const at = new Date(r.createdAt).getTime();
    const prev = lastRoute.get(key);
    if (!prev || at > prev.at) {
      lastRoute.set(key, {
        at,
        route: { folio: r.folio ?? null, routeDate: ymd(r.routeDate ?? r.createdAt), closed: !!Number(r.closed) },
      });
    }
  }

  // Ingreso "entregado" vivo: el del registro, o el de la guía sin registro ligado (altas viejas).
  const incomes: any[] = await manager.query(
    `SELECT id, cost, shipmentId FROM income
      WHERE active = 1 AND sourceType = 'shipment' AND incomeType = 'entregado'
        AND (shipmentId IN (?) OR (trackingNumber = ? AND shipmentId IS NULL))`,
    [shipmentIds.length ? shipmentIds : [''], trackingNumber],
  );
  const orphan = incomes.find((i) => !i.shipmentId);

  return rows.map((r) => {
    const own = r.kind === 'shipment' ? incomes.find((i) => i.shipmentId === r.id) ?? orphan : null;
    return {
      kind: r.kind,
      id: r.id,
      createdAt: new Date(r.createdAt),
      status: r.status,
      consolidatedId: r.consolidatedId ?? null,
      consNumber: r.consNumber ?? null,
      consDate: ymd(r.consDate),
      subsidiaryId: r.subsidiaryId ?? null,
      subsidiaryName: r.subsidiaryName ?? null,
      recipientName: r.recipientName ?? null,
      recipientAddress: r.recipientAddress ?? null,
      recipientCity: r.recipientCity ?? null,
      recipientZip: r.recipientZip ?? null,
      lastRoute: lastRoute.get(`${r.kind}:${r.id}`)?.route ?? null,
      entregadoIncome: own ? { id: own.id, cost: Number(own.cost) } : null,
    } as DevolutionRecord;
  });
}
