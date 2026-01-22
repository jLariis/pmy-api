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
  };
  isConsolidatedComplete: boolean;
  shipmentCounts: {
    total: number;
    en_ruta: number;
    en_bodega: number;      // Nuevo: Paquetes recibidos pero no despachados
    entregado: number;
    dex03: number;          // Dirección incorrecta
    dex07: number;          // Rechazado
    dex08: number;          // Cliente no disponible
    other: number;          // Otros estados (ej. Devueltos, Dañados, etc.)
  };
  shipments: any[];
}