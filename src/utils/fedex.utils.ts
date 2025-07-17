import { ShipmentFedexStatusType, ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import fs from 'fs';
import path from 'path';

const unmappedStatuses = new Set<string>();

function isValidFedexStatus(status: string): status is ShipmentFedexStatusType {
  return Object.values(ShipmentFedexStatusType).includes(status as ShipmentFedexStatusType);
}

export function mapFedexStatusToLocalStatus(derivedStatusCode: string, exceptionCode?: string): ShipmentStatusType {
  const statusMap: { [key: string]: ShipmentStatusType } = {
    'DL': ShipmentStatusType.ENTREGADO,
    'PU': ShipmentStatusType.RECOLECCION,
    'IT': ShipmentStatusType.EN_RUTA,
    'AR': ShipmentStatusType.EN_RUTA,
    'AF': ShipmentStatusType.EN_RUTA,
    'DP': ShipmentStatusType.EN_RUTA,
    'CP': ShipmentStatusType.EN_RUTA,
    'CC': ShipmentStatusType.EN_RUTA,
    'DE': ShipmentStatusType.NO_ENTREGADO,
    'DU': ShipmentStatusType.NO_ENTREGADO,
    'RF': ShipmentStatusType.NO_ENTREGADO,
    'TA': ShipmentStatusType.PENDIENTE,
    'TD': ShipmentStatusType.PENDIENTE,
    'HL': ShipmentStatusType.PENDIENTE,
    'OC': ShipmentStatusType.EN_RUTA,
  };
  
  const status = statusMap[derivedStatusCode] || ShipmentStatusType.DESCONOCIDO;

  if (status === ShipmentStatusType.DESCONOCIDO) {
    console.warn(`Unmapped derivedStatusCode: ${derivedStatusCode}, exceptionCode: ${exceptionCode}`);
  }
  return status;
}