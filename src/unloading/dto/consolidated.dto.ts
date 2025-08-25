export class ConsolidatedItemDto {
  id: string;
  type: string;
  typeCode: string;
  added: string[];
  notFound: string[];
  color: string;
  [key: string]: any;
}

export class ConsolidatedsDto {
  airConsolidated: ConsolidatedItemDto[];
  groundConsolidated: ConsolidatedItemDto[];
  f2Consolidated: ConsolidatedItemDto[];
}