/**
 * Tipos del Consolidador por zona. Espejo en app-pmy: `lib/types/consolidador-zone.ts` — mantener en sync.
 */

/** Sucursal dentro del alcance (zona o sucursal sola). */
export interface ScopeSubsidiary {
  id: string;
  name: string;
}

/** Resultado de una vista para UNA sucursal de la zona. `error` en llano si esa sucursal no se pudo cargar. */
export interface ZonePart<T> {
  subsidiaryId: string;
  subsidiaryName: string;
  data: T | null;
  error: string | null;
}

/** Vistas que se pueden pedir por zona (`GET consolidador/zone/:zoneId/:from/:to/:view`). */
export type ZoneView =
  | 'week'
  | 'by-route'
  | 'by-consolidado'
  | 'cobros-audit'
  | 'summary'
  | 'charge-guides'
  | 'collections'
  | 'novan';

export const ZONE_VIEWS: ZoneView[] = ['week', 'by-route', 'by-consolidado', 'cobros-audit', 'summary', 'charge-guides', 'collections', 'novan'];

// ───────────────────────── Cargas: guías dobles (paquete + carga) ─────────────────────────

/** Guía dentro de una carga (F2 / 1.5 ton) de la semana. */
export interface ChargeGuideInput {
  chargeShipmentId: string;
  trackingNumber: string;
  chargeId: string;
  consNumber: string | null;
  chargeDay: string; // YYYY-MM-DD
  uploadedAt: string | null;
  uploadedBy: string | null;
}

/** La misma guía registrada como paquete (shipment). */
export interface ShipmentTwin {
  shipmentId: string;
  trackingNumber: string;
  consNumber: string | null;
  consDay: string | null; // YYYY-MM-DD del consolidado
  createdAt: string;
}

/** Cobro activo del paquete (income sourceType='shipment'). */
export interface PackageIncome {
  incomeId: string;
  trackingNumber: string;
  shipmentId: string | null;
  cost: number;
  day: string;
}

export interface ChargeGuideRow extends ChargeGuideInput {
  twin: ShipmentTwin | null;
  packageIncome: PackageIncome | null;
  /** También existe como paquete (consolidado de la misma semana o la anterior). */
  isDouble: boolean;
  /** Doble y el paquete tiene cobro activo → se cobró de más. */
  overcharged: boolean;
}

export interface ChargeGuidesReport {
  charges: {
    chargeId: string;
    consNumber: string | null;
    chargeDay: string;
    uploadedAt: string | null;
    uploadedBy: string | null;
    guides: number;
    doubles: number;
  }[];
  rows: ChargeGuideRow[];
  totals: { guides: number; doubles: number; overcharged: number; overchargedAmount: number };
}

// ───────────────────────── Recolecciones ─────────────────────────

export type CollectionAuditStatus = 'cobrada' | 'sin_cobro' | 'no_cobra_315' | 'duplicada';

export interface CollectionAuditRow {
  trackingNumber: string;
  day: string; // día Hermosillo del registro
  registeredAt: string;
  routeLabel: string | null; // "Ruta 068422797359 · 14/10" si vino en un cierre
  is315: boolean;
  fedexPickedUpDay: string | null; // de la caché FedEx; null si no se ha verificado o no aparece
  fedexChecked: boolean;
  status: CollectionAuditStatus;
  incomeIds: string[];
  amount: number; // suma de cobros activos
}

export interface CollectionsAuditReport {
  rows: CollectionAuditRow[];
  totals: { registered: number; charged: number; withoutCharge: number };
  /** Costo de una recolección en la sucursal (para "Generar cobro"). */
  expectedCost: number;
}
