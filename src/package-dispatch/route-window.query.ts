import { DataSource, EntityManager } from 'typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { RouteDayFedexEvent } from 'src/tracking-sync/closure-stuck-resolver.util';

export type RouteWindowKey = `shipment:${string}` | `charge:${string}`;

export interface RouteWindowContext {
  /** Cuándo salió cada guía en la SIGUIENTE ruta (sin entrada = no ha vuelto a salir). */
  nextDispatchAt: Map<string, Date>;
  /** Arreglo manual del superadmin guardado en `package_dispatch_history` de ESTA salida. */
  overrides: Map<string, RouteDayFedexEvent>;
}

export const routeWindowKey = (kind: 'shipment' | 'charge', id: string): RouteWindowKey => `${kind}:${id}`;

/**
 * Contexto de la ventana del cierre de UNA salida: para cada guía de la salida, cuándo ese mismo
 * número de guía salió en OTRA salida activa (fin de la ventana) y el arreglo manual del cierre. Fuente común de la vista del cierre, el cobro del cierre y el
 * diagnóstico de "Paquetes con problema".
 */
export async function loadRouteWindowContext(
  db: DataSource | EntityManager,
  dispatchId: string,
): Promise<RouteWindowContext> {
  // Fin de la ventana = la siguiente vez que el MISMO NÚMERO DE GUÍA sale en otra salida activa.
  // Por número de guía (no por registro): una guía que vuelve a salir casi siempre es un
  // registro nuevo (nueva subida F2/consolidado). Se usa package_dispatch.createdAt (misma
  // convención UTC que el historial; history.addedAt viene del DEFAULT de MySQL, corrido 7 h).
  const nextRows: any[] = await db.query(
    `WITH mine AS (
       SELECT h.shipmentId AS sid, h.chargeShipmentId AS cid, COALESCE(s.trackingNumber, c.trackingNumber) AS tn
         FROM package_dispatch_history h
         LEFT JOIN shipment s ON s.id = h.shipmentId
         LEFT JOIN charge_shipment c ON c.id = h.chargeShipmentId
        WHERE h.dispatchId = ?
     ), others AS (
       SELECT s2.trackingNumber AS tn, p2.createdAt AS at
         FROM shipment s2
         JOIN package_dispatch_history h2 ON h2.shipmentId = s2.id
         JOIN package_dispatch p2 ON p2.id = h2.dispatchId AND p2.active = 1
        WHERE s2.trackingNumber IN (SELECT tn FROM mine) AND h2.dispatchId <> ?
       UNION ALL
       SELECT c2.trackingNumber AS tn, p2.createdAt AS at
         FROM charge_shipment c2
         JOIN package_dispatch_history h2 ON h2.chargeShipmentId = c2.id
         JOIN package_dispatch p2 ON p2.id = h2.dispatchId AND p2.active = 1
        WHERE c2.trackingNumber IN (SELECT tn FROM mine) AND h2.dispatchId <> ?
     )
     SELECT m.sid, m.cid, MIN(o.at) AS nextAt
       FROM mine m
       JOIN others o ON o.tn = m.tn AND o.at > (SELECT createdAt FROM package_dispatch WHERE id = ?)
      GROUP BY m.sid, m.cid`,
    [dispatchId, dispatchId, dispatchId, dispatchId],
  );
  const overrideRows: any[] = await db.query(
    `SELECT shipmentId, chargeShipmentId, closureStatus, closureExceptionCode, closureStatusAt
       FROM package_dispatch_history
      WHERE dispatchId = ? AND closureStatus IS NOT NULL`,
    [dispatchId],
  );

  const nextDispatchAt = new Map<string, Date>();
  const overrides = new Map<string, RouteDayFedexEvent>();
  for (const r of nextRows) {
    const key = r.sid ? routeWindowKey('shipment', r.sid) : r.cid ? routeWindowKey('charge', r.cid) : null;
    if (!key || !r.nextAt) continue;
    const d = new Date(r.nextAt);
    if (!isNaN(d.getTime())) nextDispatchAt.set(key, d);
  }
  for (const r of overrideRows) {
    const key = r.shipmentId
      ? routeWindowKey('shipment', r.shipmentId)
      : r.chargeShipmentId
        ? routeWindowKey('charge', r.chargeShipmentId)
        : null;
    if (!key || !r.closureStatus || !r.closureStatusAt) continue;
    overrides.set(key, {
      status: r.closureStatus as ShipmentStatusType,
      occurredAt: new Date(r.closureStatusAt),
      exceptionCode: r.closureExceptionCode ?? null,
    });
  }
  return { nextDispatchAt, overrides };
}
