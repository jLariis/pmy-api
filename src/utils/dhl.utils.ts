import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';

export function mapDhlStatusTextToEnum(code: string): ShipmentStatusType {
  const statusMap: Record<string, ShipmentStatusType> = {
    'PU': ShipmentStatusType.RECOLECCION,
    'PL': ShipmentStatusType.EN_RUTA,
    'DF': ShipmentStatusType.EN_RUTA,
    'AR': ShipmentStatusType.EN_RUTA,
    'OH': ShipmentStatusType.PENDIENTE,
    'FD': ShipmentStatusType.ENTREGADO,
    'MS': ShipmentStatusType.PENDIENTE, // INCIDENCIA
    'TD': ShipmentStatusType.PENDIENTE, // INCIDENCIA
    'CI': ShipmentStatusType.EN_RUTA,
    'RW': ShipmentStatusType.EN_RUTA,
    'SA': ShipmentStatusType.EN_RUTA,
    'HN': ShipmentStatusType.EN_RUTA,
    'IA': ShipmentStatusType.EN_RUTA
  };

  return statusMap[code] || ShipmentStatusType.PENDIENTE;
}

/**
 * Mapea el ESTATUS PRINCIPAL de 17TRACK v2.4 (`track_info.latest_status.status`)
 * al estatus local de la app. OJO: son los valores de 17TRACK (InTransit,
 * Delivered, …), NO los códigos nativos de DHL (PU/PL/…); por eso es un mapa
 * aparte de `mapDhlStatusTextToEnum`.
 *
 * Devuelve `null` para estados que NO conviene persistir (NotFound / sin dato),
 * para que el servicio simplemente los omita.
 */
export function map17TrackStatusToLocal(status: string): ShipmentStatusType | null {
  const key = (status || '').trim().toLowerCase();
  const map: Record<string, ShipmentStatusType | null> = {
    delivered: ShipmentStatusType.ENTREGADO,
    outfordelivery: ShipmentStatusType.EN_RUTA,
    intransit: ShipmentStatusType.EN_TRANSITO,
    inforeceived: ShipmentStatusType.RECOLECCION,
    availableforpickup: ShipmentStatusType.ES_OCURRE,
    deliveryfailure: ShipmentStatusType.NO_ENTREGADO,
    exception: ShipmentStatusType.PENDIENTE, // incidencia (espejo de MS/TD)
    expired: ShipmentStatusType.PENDIENTE,
    notfound: null,
    undelivered: ShipmentStatusType.NO_ENTREGADO,
  };
  return key in map ? map[key] : ShipmentStatusType.PENDIENTE;
}