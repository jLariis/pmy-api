import { ShipmentFedexStatusType, ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import fs from 'fs';
import path from 'path';

const unmappedStatuses = new Set<string>();

function isValidFedexStatus(status: string): status is ShipmentFedexStatusType {
  return Object.values(ShipmentFedexStatusType).includes(status as ShipmentFedexStatusType);
}

export function mapFedexStatusToLocalStatus(
  code: string,
  exceptionCode?: string
): ShipmentStatusType {
  switch (code) {
    case 'DL': // Delivered
      return ShipmentStatusType.ENTREGADO;

    case 'PU': // Picked up
    case 'OC': // Shipment information sent to FedEx
      return ShipmentStatusType.RECOLECCION;

    case 'AR': // Arrived at hub/facility
    case 'DP': // Departed FedEx hub / Left origin
    case 'AF': // At local FedEx facility
    case 'IT': // In transit / On the way
      return ShipmentStatusType.EN_RUTA;

    case 'DE': // Delivery exception
      // Solo ciertos códigos son NO_ENTREGADO
      if (['03', '07', '08', '17'].includes(exceptionCode ?? '')) {
        return ShipmentStatusType.NO_ENTREGADO;
      } else {
        return ShipmentStatusType.DESCONOCIDO;
      }

    default:
      return ShipmentStatusType.DESCONOCIDO;
  }
}