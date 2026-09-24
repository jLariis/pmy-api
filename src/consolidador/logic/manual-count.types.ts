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
}

export interface ManualCountTotals {
  manual: Record<Mark, number>;
  fedex: Record<Mark, number>;
  charged: Record<Mark, number>;
  byVerdict: Record<Verdict, number>;
}

export interface ManualCountReport {
  subsidiaryId: string;
  subsidiaryName: string | null;
  day: string;
  fedexFailures: number;
  totals: ManualCountTotals;
  rows: DiagnosisRow[];
}

export interface ManualLists {
  pod: string[];
  dex07: string[];
  dex08: string[];
}
