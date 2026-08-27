import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';

/**
 * Mapeo CANÓNICO NUEVO de FedEx → estatus local. Es independiente de los mapeos legados
 * (`mapFedexStatusToEnum` en fedex.service, `mapFedexStatusToLocalStatus` en fedex.utils):
 * no los toca, se construye como fuente única con precedencia explícita para poder
 * compararlo contra ellos (verificación cruzada) y, si demuestra ser mejor, reemplazarlos.
 *
 * Precedencia:
 *   1. Entregado (derivedCode DL) manda por encima de todo.
 *   2. Si hay exceptionCode conocido, REFINA el estatus (el código de FedEx es autoritativo:
 *      define el desenlace fino, p.ej. IT + 14 → retorno_abandono_fedex).
 *   3. Si no, se mapea por derivedCode (movimiento macro: en ruta, estación, etc.).
 *   4. Si nada resuelve, DESCONOCIDO.
 */

/** exceptionCode / ancillary reason → estatus local (refina el desenlace). */
const EXCEPTION_CODE_TO_STATUS: Record<string, ShipmentStatusType> = {
  '07': ShipmentStatusType.RECHAZADO,
  '08': ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  '72': ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  '67': ShipmentStatusType.EN_BODEGA,
  // 44 es el equivalente del 67 para sucursales con monitorFedexCode44. OJO: FedEx lo
  // entrega en ancillaryDetails.reason (no como scanEvent.exceptionCode) — ver fedex-local-scan.util.
  '44': ShipmentStatusType.EN_BODEGA,
  '03': ShipmentStatusType.DIRECCION_INCORRECTA,
  A12: ShipmentStatusType.DIRECCION_INCORRECTA,
  A13: ShipmentStatusType.DIRECCION_INCORRECTA,
  '05': ShipmentStatusType.RESTRICCION_SEGURIDAD_UBICACION,
  '15': ShipmentStatusType.ESTACION_FEDEX,
  '64': ShipmentStatusType.ESTACION_FEDEX,
  '14': ShipmentStatusType.RETORNO_ABANDONO_FEDEX,
  '086C': ShipmentStatusType.RETORNO_ABANDONO_FEDEX,
  '17': ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
  '84': ShipmentStatusType.DEMORA_EN_ENTREGA,
  '31': ShipmentStatusType.LLEGADO_DESPUES,
  '42': ShipmentStatusType.EMPRESA_CERRADA,
  '93': ShipmentStatusType.NO_SE_PUDO_RECOLECTAR_EL_COBRO,
  OD: ShipmentStatusType.ACARGO_DE_FEDEX,
};

/** derivedCode (movimiento macro) → estatus local. */
const DERIVED_CODE_TO_STATUS: Record<string, ShipmentStatusType> = {
  DL: ShipmentStatusType.ENTREGADO,
  IT: ShipmentStatusType.EN_RUTA,
  OD: ShipmentStatusType.EN_RUTA,
  PU: ShipmentStatusType.RECOLECCION,
  AR: ShipmentStatusType.EN_RUTA,
  DP: ShipmentStatusType.EN_RUTA,
  AF: ShipmentStatusType.EN_RUTA,
  AP: ShipmentStatusType.EN_RUTA,
  DP_HUB: ShipmentStatusType.EN_RUTA,
  RS: ShipmentStatusType.DEVUELTO_A_FEDEX,
  RT: ShipmentStatusType.DEVUELTO_A_FEDEX,
  RR: ShipmentStatusType.DEVUELTO_A_FEDEX,
  HL: ShipmentStatusType.ESTACION_FEDEX,
  DE: ShipmentStatusType.NO_ENTREGADO,
  SE: ShipmentStatusType.NO_ENTREGADO,
  DY: ShipmentStatusType.DEMORA_EN_ENTREGA,
  CA: ShipmentStatusType.OTRO,
  OC: ShipmentStatusType.PENDIENTE,
};

export interface CanonicalStatusInput {
  derivedCode?: string | null;
  statusCode?: string | null;
  exceptionCode?: string | null;
}

/**
 * Resuelve el estatus canónico a partir de los códigos de FedEx.
 * Devuelve `null` cuando no hay ninguna señal (sin derivedCode ni exceptionCode).
 */
export function resolveCanonicalStatus(input: CanonicalStatusInput): ShipmentStatusType | null {
  const derived = (input.derivedCode || input.statusCode || '').toUpperCase();
  const exception = (input.exceptionCode || '').toUpperCase();

  // 1. Entregado manda.
  if (derived === 'DL') return ShipmentStatusType.ENTREGADO;

  // 2. exceptionCode refina (autoritativo de FedEx).
  if (exception && EXCEPTION_CODE_TO_STATUS[exception]) {
    return EXCEPTION_CODE_TO_STATUS[exception];
  }

  // 3. derivedCode (movimiento macro).
  if (derived && DERIVED_CODE_TO_STATUS[derived]) {
    return DERIVED_CODE_TO_STATUS[derived];
  }

  // 4. Sin señal.
  if (!derived && !exception) return null;
  return ShipmentStatusType.DESCONOCIDO;
}

export function isDeliveredStatus(status: ShipmentStatusType | null): boolean {
  return status === ShipmentStatusType.ENTREGADO || status === ShipmentStatusType.ENTREGADO_POR_FEDEX;
}

export function isTerminalStatus(status: ShipmentStatusType | null): boolean {
  return !!status && TERMINAL_SHIPMENT_STATUSES.includes(status);
}
