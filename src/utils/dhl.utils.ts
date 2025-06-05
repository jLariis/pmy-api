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