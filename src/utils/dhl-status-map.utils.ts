import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export function mapDhlStatusTextToEnum(text: string): ShipmentStatusType {
  const normalized = text.toLowerCase();

  if (normalized.includes('entregado')) return ShipmentStatusType.ENTREGADO;
  if (normalized.includes('no entregado')) return ShipmentStatusType.NO_ENTREGADO;
  if (normalized.includes('en ruta') || normalized.includes('transito')) return ShipmentStatusType.EN_RUTA;
  if (normalized.includes('pendiente')) return ShipmentStatusType.PENDIENTE;
  if (normalized.includes('recoleccion') || normalized.includes('pickup')) return ShipmentStatusType.RECOLECCION;

  // Fallback por si no hay coincidencia
  return ShipmentStatusType.PENDIENTE;
}