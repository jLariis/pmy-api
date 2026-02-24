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
    countNormal: number;
    countF2: number;
    en_ruta: number;
    en_bodega: number;
    entregado: number;
    dex03: number;
    dex07: number;
    dex08: number;
    totalDex: number;
    totalDevueltos: number;   // Nuevo: devuelto_a_fedex + retorno_abandono
    pendiente: number;        // total - (entregado + totalDex + totalDevueltos)
    porcEfectividad: number;  // (entregado / total)
    porcEfectividadEntrega: number; // (entregado / (entregado + totalDex))
    porcRendimientoIntentos: number; // ((entregado + totalDex + totalDevueltos) / total)
    other: number;
  };
  shipments: any[];
}