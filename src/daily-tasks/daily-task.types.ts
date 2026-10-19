/** Tipos compartidos de Tareas del día (checklist automático por consolidado y por sucursal). */

export type TaskRefType = 'consolidated' | 'charge' | 'subsidiary';
export type TaskStep = 'upload' | 'unloading' | 'dispatch' | 'closure' | 'devolutions' | 'inventory_initial' | 'inventory_final';
export type TaskStatus = 'pending' | 'partial' | 'done' | 'late';

/** Horarios ya resueltos (sucursal → general → predefinido). Horas en HH:MM de Hermosillo. */
export interface Schedule {
  uploadMinutes: number;
  unloadingTime: string;
  dispatchAfterUnloadMinutes: number;
  dispatchNextDayTime: string;
  closureTime: string;
  inventoryInitialTime: string;
  devolutionsTime: string;
  inventoryFinalTime: string;
  activeTo: string;
  completePct: number;
}

export interface Progress {
  done: number;
  total: number;
  first: Date | null;
  last: Date | null;
  lastById?: string | null;
  lastByName?: string | null;
}

export interface ConsolidatedFacts {
  refType: 'consolidated' | 'charge';
  refId: string;
  consNumber: string;
  day: string;
  carrier: string;
  type: string;
  guides: number;
  uploadedAt: Date;
  uploadedById: string | null;
  uploadedByName: string | null;
  unloading: Progress;
  dispatch: Progress;
  closure: Progress;
}

export interface SubsidiaryDayFacts {
  day: string;
  inventoryInitialAt: Date | null;
  inventoryFinalAt: Date | null;
  inventoryInitialBy: string | null;
  inventoryFinalBy: string | null;
  dispatchesTotal: number;
  dispatchesClosed: number;
  lastClosureAt: Date | null;
}

export interface TaskRow {
  refType: TaskRefType;
  refId: string;
  consNumber: string | null;
  step: TaskStep;
  status: TaskStatus;
  doneCount: number;
  totalCount: number;
  dueAt: Date;
  doneAt: Date | null;
  doneById: string | null;
  doneByName: string | null;
}
