import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export class ValidateShipmentDto {
  id: string;
  trackingNumber: string;
  status: string;
  subsidiaryId: string;    // Nuevo campo
  subsidiaryName: string;  // Existente
  hasIncome: boolean;
  isCharge: boolean;
  /**
   * ¿La guía perteneció alguna vez a un `package_dispatch` (salida a ruta)?
   * El ingreso de shipment SOLO lo genera el cierre de ruta, así que una guía que nunca
   * salió a ruta nunca genera ingreso. Sirve para que la UI muestre "Sin ruta" en vez de un
   * "Ingreso: No" a secas (que confunde y parece falla del sistema). Undefined en cargas.
   */
  wasDispatched?: boolean;
  /**
   * Ingreso `entregado` VIGENTE (active) de la guía, si existe. Si viene, al regresar el paquete
   * a FedEx ese ingreso se anulará → el front pide confirmación mostrando guía/sucursal/monto.
   * Null cuando no hay ingreso entregado que anular. Solo aplica a shipment (las cargas cobran
   * agrupado). Ver processOneDevolution + migración 064.
   */
  entregadoIncome?: { id: string; cost: number } | null;
  hasError?: boolean;
  errorMessage?: string;
  lastStatus: {
    type: string | null;
    exceptionCode: string | null;
    notes: string | null;
  } | null;
}