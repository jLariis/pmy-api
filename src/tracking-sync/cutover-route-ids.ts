import { DataSource } from 'typeorm';
import { TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';

const TERMINAL_LC = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());

/**
 * Ids (envíos y cargas) que toma el motor nuevo en modo 'coexist': guías FedEx activas, no
 * terminales, de las salidas a ruta con `routeDate = hoy` de las sucursales en cutover. MISMO
 * criterio que `RouteUniverseService.todayRouteItems` (FK vivo `routeId`), para que el legacy ceda
 * exactamente lo que el motor revisa y ninguna guía quede sin dueño ni con dos.
 */
export async function loadCutoverRouteIds(
  ds: DataSource,
  subsidiaryIds: string[],
  now: Date = new Date(),
): Promise<{ shipments: Set<string>; charges: Set<string> }> {
  const out = { shipments: new Set<string>(), charges: new Set<string>() };
  if (!subsidiaryIds.length) return out;
  const day = toHermosilloDateString(now);
  const subs = subsidiaryIds.map(() => '?').join(',');
  const term = TERMINAL_LC.map(() => '?').join(',');
  const sql = (table: string) =>
    `SELECT s.id FROM ${table} s JOIN package_dispatch pd ON pd.id = s.routeId
      WHERE DATE(pd.routeDate) = ? AND s.subsidiaryId IN (${subs})
        AND LOWER(s.shipmentType) = 'fedex' AND LOWER(s.status) NOT IN (${term}) AND s.active = 1`;
  const params = [day, ...subsidiaryIds, ...TERMINAL_LC];
  const [ships, charges] = await Promise.all([
    ds.query(sql('shipment'), params),
    ds.query(sql('charge_shipment'), params),
  ]);
  for (const r of ships) out.shipments.add(r.id);
  for (const r of charges) out.charges.add(r.id);
  return out;
}
