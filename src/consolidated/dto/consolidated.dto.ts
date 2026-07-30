export interface ConsolidatedDto {
  id: string;
  date: Date;
  consolidatedDate: Date;
  numberOfPackages: number;
  consNumber: string;
  carrier: string;
  type: string;
  subsidiary: {
    id: string;
    name: string;
  };
  isConsolidatedComplete: boolean;
  /** Estatus del cuadre operativo: 'cerrado' cuando no hay guías pendientes de movimiento, si no 'abierto'. */
  estatusCuadre: 'cerrado' | 'abierto';
  shipmentCounts: {
    total: number;
    countNormal: number;
    countF2: number;
    countHighValue: number;   // Alto Valor: subconjunto de Normales (shipment.isHighValue)
    countCobros: number;      // Cobros: # de paquetes con pago (payment.amount > 0); shipment o charge/F2
    montoCobros: number;      // Cobros: monto total $ (SUM payment.amount) de esos paquetes
    totalCargas: number;      // TOTAL CARGA del cuadre = countNormal + countF2
    en_ruta: number;
    en_bodega: number;
    entregado: number;        // POD
    dex03: number;
    dex07: number;
    dex08: number;
    ocurre: number;           // Ocurre (es_ocurre)
    totalDex: number;
    podPlusDexs: number;      // POD + DEX07 + DEX03 + DEX08 + Ocurre
    guiasPendientesDeMov: number; // guías aún sin movimiento (pendiente/en_bodega/en_ruta/...)
    otros: number;            // ya tuvieron movimiento pero fuera de POD/DEX/Ocurre (total - podPlusDexs - pendientes)
    otrosBreakdown: Record<string, number>; // desglose de "otros" por estatus, para diagnóstico
    totalDevueltos: number;   // Nuevo: devuelto_a_fedex + retorno_abandono
    pendiente: number;        // total - (entregado + totalDex + totalDevueltos)
    porcEfectividad: number;  // (entregado / total)
    porcEfectividadEntrega: number; // (entregado / (entregado + totalDex))
    porcRendimientoIntentos: number; // ((entregado + totalDex + totalDevueltos) / total)
    other: number;
  };
  shipments: any[];
  pendingShipments: any[]; // Nuevo: lista de envíos pendientes asociados a este consolidado
}