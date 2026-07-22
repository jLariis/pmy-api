export class ConsolidatedItemDto {
  id: string;
  type: string;
  typeCode: string;
  added: ShortShipmentInfo[];
  notFound: ShortShipmentInfo[];
  color: string;
  [key: string]: any;
}

export class ShortShipmentInfo {
  id?: string;
  trackingNumber: string;
  /** Variante DHL (JD/JJD) del paquete; necesaria para casar faltantes DHL en el cliente. */
  dhlUniqueId?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  recipientZip?: string;
}

export class ConsolidatedsDto {
  airConsolidated: ConsolidatedItemDto[];
  groundConsolidated: ConsolidatedItemDto[];
  f2Consolidated: ConsolidatedItemDto[];
}