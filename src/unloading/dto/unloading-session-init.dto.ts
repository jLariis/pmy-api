import { ShortShipmentInfo } from './consolidated.dto';

export class ConsolidatedInitItemDto {
  id: string;
  type: string;
  typeCode: string;
  numberOfPackages: number;
  /** Número de consolidado (para mostrarlo/identificarlo en el cliente). */
  consNumber?: string;
  color: string;
  expected: ShortShipmentInfo[];
}

export class UnloadingSessionInitDto {
  airConsolidated: ConsolidatedInitItemDto[];
  groundConsolidated: ConsolidatedInitItemDto[];
  f2Consolidated: ConsolidatedInitItemDto[];
}
