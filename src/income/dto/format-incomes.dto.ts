type IncomeType = 'shipment' | 'carga' | 'collection' | 'traslado';

interface ReportItem {
  type: IncomeType;
  trackingNumber: string;
  shipmentType?: string;
  status?: string;
  date: string;
  cost?: number;
  /** Parte del `cost` de una carga que corresponde al 2º a bordo (derivado, informativo). */
  secondAbord?: number;
}

export class FormatIncomesDto {
  date: string;
  fedex: {
    pod: number;
    dex07: number;
    dex08: number;
    total: number;
    totalIncome: string;
  };
  dhl: {
    ba: number;
    ne: number;
    total: number;
    totalIncome: string;
  };
  transfers: {
    tyco: number;
    aeropuerto: number;
    especial: number;
    total: number;
    totalIncome: string;
  };
  collections: number;
  cargas: number;
  total: number;
  totalIncome: string;
  items: ReportItem[];
}
