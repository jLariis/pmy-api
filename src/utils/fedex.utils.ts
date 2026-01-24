import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export function mapFedexStatusToLocalStatus(derivedStatusCode: string, exceptionCode?: string): ShipmentStatusType {
  const excCode = exceptionCode?.trim().toUpperCase();
  const code = derivedStatusCode?.trim().toUpperCase();

  // --- PRIORIDAD: EXCEPTION CODES ---
  if (excCode) {
    switch (excCode) {
      case '07': return ShipmentStatusType.RECHAZADO;
      case '08': return ShipmentStatusType.CLIENTE_NO_DISPONIBLE;
      case '67': return ShipmentStatusType.EN_BODEGA;
      case '03':
      case 'A12':
      case 'A13': return ShipmentStatusType.DIRECCION_INCORRECTA;
      case '41': 
      case '11': 
      case 'DF': return ShipmentStatusType.PENDIENTE; 
      case '15':
      case '64': return ShipmentStatusType.ESTACION_FEDEX;
      case '14':
      case '086C': return ShipmentStatusType.RETORNO_ABANDONO_FEDEX;
      case '84': 
      case '17': return ShipmentStatusType.CAMBIO_FECHA_SOLICITADO;
      case '20': 
      case '79':
      case '79A': return ShipmentStatusType.PENDIENTE;
      case '08D': return ShipmentStatusType.NO_ENTREGADO;
      case '71':
      case '72': return ShipmentStatusType.CLIENTE_NO_DISPONIBLE;
    }
  }

  // --- MAPEO POR DERIVED STATUS (Respaldo) ---
  const statusMap: { [key: string]: ShipmentStatusType } = {
    'DL': ShipmentStatusType.ENTREGADO,
    'PU': ShipmentStatusType.RECOLECCION,
    'OC': ShipmentStatusType.RECOLECCION,
    'FD': ShipmentStatusType.PENDIENTE,
    'IT': ShipmentStatusType.PENDIENTE,
    'OW': ShipmentStatusType.PENDIENTE,
    'HL': ShipmentStatusType.PENDIENTE,
    'DE': ShipmentStatusType.NO_ENTREGADO,
    'DU': ShipmentStatusType.PENDIENTE,     
    'TA': ShipmentStatusType.NO_ENTREGADO,
    'OD': ShipmentStatusType.ACARGO_DE_FEDEX, 
    'SE': ShipmentStatusType.NO_ENTREGADO, 
    'RF': ShipmentStatusType.RECHAZADO,
    'IN': ShipmentStatusType.PENDIENTE,
  };

  return statusMap[code] || ShipmentStatusType.DESCONOCIDO;
}