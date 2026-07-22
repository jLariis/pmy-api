const TZ = 'America/Hermosillo';

function formatToHermosillo(date: Date | string | null | undefined): string {
  if (!date) return '';
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

/** Fiel a `tipoXls` de `ShipmentsService.generatePendingShipmentsExcel`. */
function tipoXls(t?: string | null): string {
  const v = String(t || '').toLowerCase();
  return v === 'fedex' ? 'FedEx' : v === 'dhl' ? 'DHL' : (t ? String(t).toUpperCase() : 'Otro');
}

export interface PendingShipmentItem {
  trackingNumber?: string | null;
  shipmentType?: string | null;
  isCharge?: boolean;
  status?: string | null;
  priority?: string | null;
  commitDateTime?: string | Date | null;
  recipientName?: string | null;
  recipientAddress?: string | null;
  recipientCity?: string | null;
  recipientZip?: string | null;
  recipientPhone?: string | null;
  receivedByName?: string | null;
  consolidatedId?: string | null;
  isHighValue?: boolean;
  createdAt?: string | Date | null;
}

export interface PendingShipmentsInput {
  shipments: PendingShipmentItem[];
}

/** `buildPendingShipmentsData` — data-provider de "Pendientes" (§B8). Espejo de
 * `ShipmentsService.generatePendingShipmentsExcel`. Recibe los shipments ya obtenidos por el
 * service (envíos + cargas pendientes por sucursal). */
export function buildPendingShipmentsData(input: PendingShipmentsInput): Record<string, any> {
  const shipments = input.shipments ?? [];
  return {
    rows: shipments.map((s) => ({
      trackingNumber: s.trackingNumber,
      tipo: tipoXls(s.shipmentType),
      carga: s.isCharge ? 'Carga' : 'Normal',
      status: s.status,
      priority: s.priority,
      commitDateTime: formatToHermosillo(s.commitDateTime),
      recipientName: s.recipientName,
      recipientAddress: s.recipientAddress,
      recipientCity: s.recipientCity,
      recipientZip: s.recipientZip,
      recipientPhone: s.recipientPhone,
      receivedByName: s.receivedByName,
      consolidatedId: s.consolidatedId,
      isHighValue: s.isHighValue ? 'Sí' : 'No',
      createdAt: formatToHermosillo(s.createdAt),
    })),
  };
}
