import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

/**
 * Estatus que provienen de FedEx (códigos DEX/STAT/OD/retornos/entrega FedEx), es decir, eventos que
 * NO hicimos nosotros. El resto se considera interno (nuestros escaneos/operaciones: recolección,
 * recibido en bodega, salida a ruta, entrega en bodega, etc.).
 */
export const FEDEX_ORIGIN_STATUSES = new Set<string>([
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  // NOTA: DEVUELTO_A_FEDEX es NUESTRA acción de devolución (no un evento reportado por FedEx) → interno.
  ShipmentStatusType.RETORNO_ABANDONO_FEDEX,
  ShipmentStatusType.ESTACION_FEDEX,
  ShipmentStatusType.LLEGADO_DESPUES,
  ShipmentStatusType.ACARGO_DE_FEDEX,
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  ShipmentStatusType.DIRECCION_INCORRECTA,
  ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
  ShipmentStatusType.DEMORA_EN_ENTREGA,
  ShipmentStatusType.EMPRESA_CERRADA,
  ShipmentStatusType.NO_SE_PUDO_RECOLECTAR_EL_COBRO,
  ShipmentStatusType.RESTRICCION_SEGURIDAD_UBICACION,
  ShipmentStatusType.CAMBIO_DOMICILIO,
]);

/** Entregas HECHAS POR NOSOTROS (no por FedEx). */
export const OUR_DELIVERY_STATUSES = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
]);

export type StatusOrigin = 'fedex' | 'interno';

export function statusOrigin(status: string | null | undefined): StatusOrigin {
  return status && FEDEX_ORIGIN_STATUSES.has(String(status)) ? 'fedex' : 'interno';
}

/** ¿La entrega fue por FedEx (entregado_por_fedex) en el estatus actual o en el historial? */
export function deliveredByFedex(
  currentStatus: string | null,
  history: Array<{ status?: string | null }>,
): boolean {
  if (currentStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX) return true;
  return (history || []).some((h) => h.status === ShipmentStatusType.ENTREGADO_POR_FEDEX);
}
