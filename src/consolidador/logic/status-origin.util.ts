import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

/**
 * Estatus INTERNOS: SOLO los que agrega la propia app. El usuario los definió explícitamente:
 * registrado, inventario, en ruta y devuelto a FedEx. TODO lo demás lo tomamos de FedEx.
 *  - pendiente                      → registrado en el sistema
 *  - recibido_en_bodega / en_bodega → inventario (escaneo a inventario/bodega)
 *  - en_ruta / en_transito          → en ruta / salida a ruta (nuestra operación)
 *  - devuelto_a_fedex               → nuestra acción de devolución
 * (consolidado y "registrado" también aparecen como eventos propios del timeline, no como estatus.)
 */
export const INTERNAL_STATUSES = new Set<string>([
  ShipmentStatusType.PENDIENTE,
  ShipmentStatusType.RECIBIDO_EN_BODEGA,
  ShipmentStatusType.EN_BODEGA,
  ShipmentStatusType.EN_RUTA,
  ShipmentStatusType.EN_TRANSITO,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
]);

/** Entregas HECHAS POR NOSOTROS (no por FedEx). */
export const OUR_DELIVERY_STATUSES = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
]);

export type StatusOrigin = 'fedex' | 'interno';

export function statusOrigin(status: string | null | undefined): StatusOrigin {
  return status && INTERNAL_STATUSES.has(String(status)) ? 'interno' : 'fedex';
}

/** ¿La entrega fue por FedEx (entregado_por_fedex) en el estatus actual o en el historial? */
export function deliveredByFedex(
  currentStatus: string | null,
  history: Array<{ status?: string | null }>,
): boolean {
  if (currentStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX) return true;
  return (history || []).some((h) => h.status === ShipmentStatusType.ENTREGADO_POR_FEDEX);
}
