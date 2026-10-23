type IncomeType = 'shipment' | 'carga' | 'collection' | 'traslado' | 'otro';

interface ReportItem {
  type: IncomeType;
  trackingNumber: string;
  shipmentType?: string;
  status?: string;
  date: string;
  cost?: number;
  /** Parte del `cost` de una carga que corresponde al 2º a bordo (derivado, informativo). */
  secondAbord?: number;
  /** ¿Suma al total según las reglas de la sucursal? */
  countable: boolean;
  /** Corrección hecha en el Consolidador: agregada a mano o editada (monto, fecha, sucursal…). */
  correction: { kind: 'agregado' | 'editado'; by: string | null; reason: string | null; at: string | null } | null;
}

/** Operaciones que SÍ cobraron (las que explican el dinero del periodo). */
export interface BilledOps {
  fedexPod: number;
  fedexDex07: number;
  fedexDex08: number;
  dhlBa: number;
  dhlNe: number;
  collections: number;
  cargas: number;
  transfers: number;
  otros: number;
  total: number;
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
  /** Monto contable de recolecciones y de cargas del día (ya incluido en `totalIncome`). */
  collectionsIncome: string;
  cargasIncome: string;
  /** "Otro" capturado a mano en el Consolidador sin guía. */
  otros: { total: number; totalIncome: string };
  total: number;
  totalIncome: string;
  /** Correcciones del Consolidador del día (ya incluidas en las columnas y en `totalIncome`). */
  corrections: { count: number; totalIncome: string };
  billed: BilledOps;
  /** Ingresos registrados que NO cobran según las reglas de la sucursal. */
  notBilled: number;
  items: ReportItem[];
}
