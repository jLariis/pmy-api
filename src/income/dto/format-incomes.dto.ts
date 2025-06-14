type IncomeType = 'shipment' | 'carga' | 'collection';

interface ReportItem {
  type: IncomeType;
  trackingNumber: string;
  shipmentType?: string;
  status?: string;
  date: string;
  cost?: number;
}

export class FormatIncomesDto {
  date: string;
  fedex: {
    pod: number;
    dex: number;
    total: number;
    totalIncome: string;
  };
  dhl: {
    ba: number;
    ne: number;
    total: number;
    totalIncome: string;
  };
  collections: number;
  cargas: number;
  total: number;
  totalIncome: string;
  items: ReportItem[];
}
