import {  ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export function mapFedexStatusToLocalStatusResp(derivedStatusCode: string, exceptionCode?: string): ShipmentStatusType {
  console.log("🚀 ~ mapFedexStatusToLocalStatus ~ derivedStatusCode:", derivedStatusCode)
  
  const statusMap: { [key: string]: ShipmentStatusType } = {
    'DL': ShipmentStatusType.ENTREGADO,
    'PU': ShipmentStatusType.RECOLECCION,
    '67': ShipmentStatusType.EN_RUTA,
    'OW': ShipmentStatusType.EN_RUTA,
    'IT': ShipmentStatusType.EN_RUTA,
    'AR': ShipmentStatusType.EN_RUTA,
    'AF': ShipmentStatusType.EN_RUTA,
    'DP': ShipmentStatusType.EN_RUTA,
    'CP': ShipmentStatusType.EN_RUTA,
    'CC': ShipmentStatusType.EN_RUTA,
    'DY': ShipmentStatusType.EN_RUTA, //podría ser pendiente 
    'DE': ShipmentStatusType.NO_ENTREGADO,
    'DU': ShipmentStatusType.NO_ENTREGADO,
    'RF': ShipmentStatusType.NO_ENTREGADO,
    'TA': ShipmentStatusType.PENDIENTE,
    'TD': ShipmentStatusType.NO_ENTREGADO,
    'HL': ShipmentStatusType.PENDIENTE,
    'OC': ShipmentStatusType.EN_RUTA,
  };
  
  const status = statusMap[derivedStatusCode] || ShipmentStatusType.DESCONOCIDO;

  if (status === ShipmentStatusType.DESCONOCIDO) {
    console.warn(`Unmapped derivedStatusCode: ${derivedStatusCode}, exceptionCode: ${exceptionCode}`);
  }
  return status;
}

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
      case '14':
      case '15':
      case '64': return ShipmentStatusType.ESTACION_FEDEX;
      case '086C': return ShipmentStatusType.RETENIDO_POR_FEDEX;
      case '84': 
      case '17': 
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
    'TA': ShipmentStatusType.NO_ENTREGADO, // <--- AGREGAR: TA es común en Excepciones (Tried Attempt)
    'SE': ShipmentStatusType.NO_ENTREGADO, // <--- AGREGAR: SE es Shipment Exception
    'RF': ShipmentStatusType.RECHAZADO,
    'IN': ShipmentStatusType.PENDIENTE,    // <--- AGREGAR: IN es In-Transit (Label Created)
  };

  return statusMap[code] || ShipmentStatusType.DESCONOCIDO;
}