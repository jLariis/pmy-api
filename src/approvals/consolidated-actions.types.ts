/**
 * Tipos de las acciones sobre consolidado con autorización. La "familia" son todas las filas
 * `consolidated` con el mismo consNumber + sucursal, más todo lo que cuelga de ellas.
 */
export type ChangeEntity = 'consolidated' | 'shipment' | 'charge_shipment' | 'charge' | 'income' | 'devolution' | 'payment';

/** Tablas donde el plan puede crear filas nuevas (cambio de tipo). */
export type InsertTable = 'shipment' | 'charge_shipment' | 'charge' | 'income' | 'shipment_status' | 'package_dispatch_history' | 'consolidated';

/** Fila nueva con su id ya generado: `values` son las columnas tal cual van a la BD. */
export interface RowInsert {
  table: InsertTable;
  id: string;
  trackingNumber: string | null;
  values: Record<string, unknown>;
}

export interface FamilyConsolidated { id: string; consNumber: string; subsidiaryId: string; date: Date }
export interface FamilyPackage { id: string; trackingNumber: string; subsidiaryId: string | null; shipmentType?: string | null }
export interface FamilyCharge { id: string; subsidiaryId: string | null; chargeDate: Date; isHalfTon: boolean }
export interface FamilyIncome {
  id: string;
  trackingNumber: string | null;
  subsidiaryId: string | null;
  sourceType: string;
  shipmentId: string | null;
  chargeId: string | null;
  cost: number;
  originalCost: number | null;
  date: Date;
  shipmentType: string | null;
  secondAbordApplied: boolean | null;
  chargeNotChargedSameDay: boolean;
}
export interface FamilyDevolution { id: string; trackingNumber: string; subsidiaryId: string | null }

export interface ConsolidatedFamily {
  consNumber: string;
  subsidiaryId: string;
  consolidated: FamilyConsolidated[];
  shipments: FamilyPackage[];
  chargeShipments: FamilyPackage[];
  charges: FamilyCharge[];
  incomes: FamilyIncome[];
  devolutions: FamilyDevolution[];
  /** Guías/cargas que hoy están en ruta (aviso). */
  enRuta: number;
  /** Guías/cargas que alguna vez salieron a ruta (aviso: sus salidas/cierres no se tocan). */
  withRoute: number;
}

export interface SubsidiaryTariff {
  id: string;
  name: string;
  fedexCostPackage: number;
  dhlCostPackage: number;
  chargeCost: number;
  chargeCostHalfTon: number;
  chargeCostSundayHoliday: number;
  chargeCostHalfTonSundayHoliday: number;
  chargeSecondAbord: boolean;
  secondAbordAmount: number;
  chargeOnlyFirstOfDay: boolean;
}

/** Un campo de un registro que cambia. `value` es el valor crudo a escribir. */
export interface FieldChange {
  entityType: ChangeEntity;
  entityId: string;
  trackingNumber: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  value: unknown;
}

export interface PlanSummary {
  consolidated: number;
  shipments: number;
  chargeShipments: number;
  charges: number;
  devolutions: number;
  incomesAnnulled: number;
  incomesMoved: number;
  incomesRecosted: number;
  incomesRedated: number;
  /** Cambio de tipo: guías que pasan a la otra tabla e ingresos que se crean. */
  converted?: number;
  incomesCreated?: number;
  /** Suma de ingresos activos de la familia antes del cambio. */
  amountBefore: number;
  /** Suma de ingresos activos de la familia después del cambio. */
  amountAfter: number;
}

export interface ActionPlan {
  changes: FieldChange[];
  /** Filas nuevas (solo cambio de tipo). Se insertan antes de los UPDATE. */
  inserts?: RowInsert[];
  summary: PlanSummary;
  warnings: string[];
}
