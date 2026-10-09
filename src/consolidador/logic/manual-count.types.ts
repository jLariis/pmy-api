/**
 * Tipos del "Conteo manual vs sistema" (Consolidador). Espejo en app-pmy:
 * `lib/types/manual-count.ts` — mantener en sync.
 */

/** Lo que el usuario puede contar: entregado (POD), DEX07 o DEX08. */
export type Mark = 'POD' | '07' | '08';
export const MARKS: Mark[] = ['POD', '07', '08'];

/** Desenlace de una guía en el día: un Mark, otro evento (`OTRO`) o nada (`null`). */
export type DayOutcome = Mark | 'OTRO' | null;

/** Lo que dice FedEx en vivo para el día consultado. */
export interface FedexLive {
  ok: boolean; // false = FedEx no respondió / sin datos
  outcome: DayOutcome;
  outcomeAt: string | null; // ISO del evento elegido
  dex08Dates: string[]; // TODOS los 08 que reporta FedEx (cualquier día)
  lastCode: string | null; // último eventType + código, informativo
  latestOutcome: DayOutcome; // desenlace del ÚLTIMO evento de FedEx (cualquier día)
  deliveredDay: string | null; // día Hermosillo en que FedEx la entregó (DL), si ya se entregó
  dayEventLabel?: string | null; // evento de FedEx del día en llano (el elegido o el último del día)
  latestEventLabel?: string | null; // último evento de FedEx en llano (cualquier día)
}

export interface RouteRef {
  dispatchId: string;
  folio: string | null;
  routeDay: string | null; // día Hermosillo de la ruta
  is315: boolean;
  closed: boolean;
}

export interface IncomeRef {
  id: string;
  mark: Mark | null; // entregado → POD; no_entregado → código
  day: string; // día Hermosillo del ingreso
  cost: number;
  active: boolean;
}

export interface GuideFacts {
  trackingNumber: string;
  kind: 'shipment' | 'charge' | null; // null = no existe en el sistema
  shipmentId?: string | null; // fila vigente (envío) — para generar el cobro desde la pantalla
  subsidiaryId: string | null;
  transferredIn: boolean; // traspaso hacia la sucursal consultada
  consolidado: { consNumber: string | null; day: string | null } | null;
  routes: RouteRef[];
  systemStatus: string | null; // estatus vivo guardado
  systemDayStatus?: string | null; // estatus del último evento guardado ESE día (shipment_status)
  systemOutcome: DayOutcome; // desenlace del día según shipment_status
  systemDex08Dates: string[];
  fedex: FedexLive | null;
  incomes: IncomeRef[]; // envío, activos y anulados
  returned: boolean; // devolución registrada ese día o después
  warehouseDelivered: boolean; // entregado en bodega ese día
}

export interface DiagnoseContext {
  day: string;
  subsidiaryId: string;
  expectedCost: number;
  isChargeable(code: 'DELIVERED' | '07' | '08'): boolean;
}

export type Verdict = 'CUADRA' | 'ERROR_SISTEMA' | 'ERROR_CONTEO' | 'REGLA' | 'OTRO_DIA';
export const VERDICTS: Verdict[] = ['CUADRA', 'ERROR_SISTEMA', 'ERROR_CONTEO', 'REGLA', 'OTRO_DIA'];

export type Cause =
  | 'NO_EXISTE'
  | 'OTRA_SUCURSAL'
  | 'SIN_CONSOLIDADO'
  | 'SIN_RUTA'
  | 'RUTA_OTRO_DIA'
  | 'ESTATUS_DESFASADO'
  | 'COBRO_DE_MAS'
  | 'COBRO_FALTANTE'
  | 'INGRESO_OTRO_DIA'
  | 'DUPLICADO'
  | 'MONTO_INCORRECTO'
  | 'ERROR_CONTEO'
  | 'REGLA_NO_COBRA'
  | 'F2_INFORMATIVO'
  | 'ENTREGADO_OTRO_DIA';

export interface ChainStep {
  step: number;
  label: string;
  ok: boolean | null; // null = no aplica / sin datos
  detail: string;
}

export interface DiagnosisRow {
  trackingNumber: string;
  manual: Mark | null;
  fedexSays: DayOutcome;
  systemSays: DayOutcome;
  /** Qué dice FedEx, exacto y en llano (p. ej. "OD · En vehículo de FedEx para entrega"). */
  fedexLabel: string;
  /** Qué tiene el sistema, exacto y en llano (p. ej. "En ruta", "Devuelto a FedEx"). */
  systemLabel: string;
  charged: Mark[];
  expected: Mark | null;
  deliveredDay: string | null; // día real de entrega según FedEx (o el ingreso POD), si ya se entregó
  verdict: Verdict;
  cause: Cause | null;
  subCause: string | null;
  explanation: string;
  chain: ChainStep[];
  cost: number | null;
  incomeIds: string[];
  /** Envío vigente de la guía (para "Generar cobro"); null en cargas F2 o si no existe. */
  shipmentId: string | null;
  /** Día diagnosticado (en la revisión por semana una guía puede salir en varios días). */
  day?: string;
}

/** Revisión por día (un día) o por semana (lunes–domingo, el conteo de toda la semana junto). */
export type ManualCountScope = 'day' | 'week';

export interface ManualCountTotals {
  manual: Record<Mark, number>;
  fedex: Record<Mark, number>;
  charged: Record<Mark, number>;
  byVerdict: Record<Verdict, number>;
}

export interface ManualCountReport {
  subsidiaryId: string;
  subsidiaryName: string | null;
  day: string; // por semana: el lunes
  scope?: ManualCountScope;
  from?: string; // por semana: lunes
  to?: string; // por semana: domingo
  fedexFailures: number;
  totals: ManualCountTotals;
  rows: DiagnosisRow[];
  /** Solo si el usuario pegó recolecciones. */
  collections?: CollectionReport;
}

export interface ManualLists {
  pod: string[];
  dex07: string[];
  dex08: string[];
  /** Recolecciones contadas a mano (opcional: si viene vacío no se revisan). */
  recolecciones?: string[];
}

// ───────────────────────── Recolecciones ─────────────────────────

export type CollectionCause =
  | 'REC_NO_EXISTE'
  | 'REC_OTRA_SUCURSAL'
  | 'REC_OTRO_DIA'
  | 'REC_FALTA_CONTEO'
  | 'REC_SIN_COBRO'
  | 'REC_DUPLICADO'
  | 'REC_MONTO'
  | 'REC_COBRO_OTRO_DIA'
  | 'REC_COBRO_315'
  | 'REC_REGLA_315';

/** Hechos de una guía recolectada (sistema + FedEx), ya juntados por el servicio. */
export interface CollectionFacts {
  trackingNumber: string;
  /** Registros como recolección (cualquier sucursal), con su día local Hermosillo. */
  registrations: { subsidiaryId: string | null; day: string }[];
  /** Vino en el cierre de una ruta 31.5 (no se cobra). */
  is315: boolean;
  /** Cobros de recolección de la guía (activos e inactivos). */
  incomes: { id: string; day: string; cost: number; active: boolean }[];
  /** FedEx en vivo: día en que la marcó "Picked up" (null si no aparece); ok=false si no respondió. */
  fedex: { ok: boolean; pickedUpDay: string | null } | null;
}

export interface CollectionRow {
  trackingNumber: string;
  day: string;
  counted: boolean;
  /** "Registrada el 08/10" / "No registrada" / "Registrada en otra sucursal". */
  systemLabel: string;
  /** "Recolectada el 08/10" / "Sin recolección en FedEx" / "FedEx no respondió". */
  fedexLabel: string;
  /** Cobros activos (monto) o "Sin cobro". */
  chargedLabel: string;
  /** FedEx la marcó "Picked up" ese mismo día. */
  pickedUpThatDay: boolean;
  /** Cobros de recolección activos. */
  chargedCount: number;
  verdict: Verdict;
  cause: CollectionCause | null;
  explanation: string;
  chain: ChainStep[];
  incomeIds: string[];
}

export interface CollectionReport {
  totals: { manual: number; fedex: number; charged: number; byVerdict: Record<Verdict, number> };
  rows: CollectionRow[];
}
