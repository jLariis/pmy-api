import { ShipmentStatusType } from './enums/shipment-status-type.enum';

type Candidate = { status?: string | null; createdAt?: Date | string | null };

export type ScanPick<S, C> =
  | { kind: 'shipment'; record: S }
  | { kind: 'charge'; record: C }
  | { kind: 'returned'; record: S | C }
  | null;

const isReturned = (r: Candidate | null | undefined) => r?.status === ShipmentStatusType.DEVUELTO_A_FEDEX;
const ts = (r: Candidate) => (r.createdAt ? new Date(r.createdAt).getTime() : 0);

/**
 * Decide qué registro sale a ruta cuando se escanea una guía que puede vivir a
 * la vez en `shipment` (consolidado) y en `charge_shipment` (carga F2/31.5).
 *
 * - Un registro DEVUELTO_A_FEDEX nunca sale a ruta: si la guía regresa, vuelve
 *   con un registro NUEVO (otro consolidado u otra carga) y es ese el que va.
 * - Entre los vivos gana el más reciente (antes ganaba siempre el shipment y
 *   "revivía" el del consolidado viejo, que el cron volvía a consultar a FedEx).
 * - Si solo hay devueltos ⇒ 'returned' (se rechaza con motivo claro).
 */
export function pickScanCandidate<S extends Candidate, C extends Candidate>(
  shipment: S | null | undefined,
  charge: C | null | undefined,
): ScanPick<S, C> {
  const liveShipment = shipment && !isReturned(shipment) ? shipment : null;
  const liveCharge = charge && !isReturned(charge) ? charge : null;

  if (liveShipment && liveCharge) {
    return ts(liveCharge) > ts(liveShipment)
      ? { kind: 'charge', record: liveCharge }
      : { kind: 'shipment', record: liveShipment };
  }
  if (liveShipment) return { kind: 'shipment', record: liveShipment };
  if (liveCharge) return { kind: 'charge', record: liveCharge };

  const returned = shipment ?? charge;
  return returned ? { kind: 'returned', record: returned } : null;
}
