import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * Escaneos del proveedor de confianza / estación local: 67 ("A trusted third-party vendor is on the
 * way") y 44. Son trazabilidad clave (se guardan SIEMPRE en el historial), pero FedEx los manda con
 * la hora adelantada (~1 h, Cabo 19-oct-2026): un 67 "posterior" a la salida a ruta regresaba el
 * paquete de EN_RUTA a EN_BODEGA (350 guías en una semana de sombra).
 */
export const VENDOR_SCAN_CODES: ReadonlySet<string> = new Set(['67', '44']);

export function isVendorScanCode(exceptionCode: string | null | undefined): boolean {
  return VENDOR_SCAN_CODES.has(String(exceptionCode ?? '').trim());
}

/**
 * Un 67/44 nunca regresa a bodega un paquete que ya salió a ruta: si el estatus actual es EN_RUTA
 * y lo único que propone FedEx es EN_BODEGA por un escaneo 67/44, se conserva EN_RUTA.
 */
export function keepRouteOverVendorScan<T extends string>(
  currentStatus: T | string | null | undefined,
  proposedStatus: T,
  newestExceptionCode: string | null | undefined,
): T {
  if (
    currentStatus === ShipmentStatusType.EN_RUTA &&
    proposedStatus === ShipmentStatusType.EN_BODEGA &&
    isVendorScanCode(newestExceptionCode)
  ) {
    return ShipmentStatusType.EN_RUTA as T;
  }
  return proposedStatus;
}
