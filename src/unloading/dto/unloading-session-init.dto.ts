import { ShortShipmentInfo } from './consolidated.dto';

export class ConsolidatedInitItemDto {
  id: string;
  type: string;
  typeCode: string;
  numberOfPackages: number;
  color: string;
  expected: ShortShipmentInfo[];
}

export class UnloadingSessionInitDto {
  airConsolidated: ConsolidatedInitItemDto[];
  groundConsolidated: ConsolidatedInitItemDto[];
  f2Consolidated: ConsolidatedInitItemDto[];
}
