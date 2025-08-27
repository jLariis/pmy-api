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
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
}

export class ConsolidatedsDto {
  airConsolidated: ConsolidatedItemDto[];
  groundConsolidated: ConsolidatedItemDto[];
  f2Consolidated: ConsolidatedItemDto[];
}