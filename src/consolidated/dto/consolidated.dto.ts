
export interface ConsolidatedDto {
  id: string;
  date: Date;
  consolidatedDate: Date;
  numberOfPackages: number;
  consNumber: string;
  type: string;
  subsidiary: {
    id: string;
    name: string;
  }; // o el tipo que corresponda
  isConsolidatedComplete: boolean;
  shipmentCounts: {
    total: number;
    en_ruta: number;
    entregado: number;
    no_entregado: number; // Cambiado de 'dex' a 'no_entregado'
    other: number;
  };
  shipments: any[];
}