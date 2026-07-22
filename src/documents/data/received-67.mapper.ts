const TZ = 'America/Hermosillo';

export interface Received67Item {
  trackingNumber?: string | null;
  fecha67?: string | Date | null;
  diasDesde67?: number | null;
  status?: string | null;
  recipientName?: string | null;
  recipientAddress?: string | null;
  recipientCity?: string | null;
  recipientZip?: string | null;
  /** Distingue Charge (Carga) de Shipment normal (Envío), fiel a `getReceivedWith67BySubsidiary`. */
  isCharge?: boolean;
}

export interface Received67Input {
  rows: Received67Item[];
}

/** `buildReceived67Data` — data-provider de "Recibidas de FedEx (con 67)" (§B7). Espejo de
 * `ShipmentsService.exportReceived67Excel`. Recibe las filas ya calculadas por el service
 * (`getReceivedWith67BySubsidiary().details`). */
export function buildReceived67Data(input: Received67Input): Record<string, any> {
  const rows = input.rows ?? [];
  return {
    rows: rows.map((r) => ({
      trackingNumber: r.trackingNumber,
      fecha67: r.fecha67 ? new Date(r.fecha67).toLocaleString('es-MX', { timeZone: TZ }) : '',
      diasDesde67: r.diasDesde67,
      status: r.status,
      recipientName: r.recipientName,
      recipientAddress: r.recipientAddress,
      recipientCity: r.recipientCity,
      recipientZip: r.recipientZip,
      tipo: r.isCharge ? 'Carga' : 'Envío',
    })),
  };
}
