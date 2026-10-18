import { addDays, atLocalTime, localDay } from '../ops-alerts/ops-alerts.util';
import { ConsolidatedFacts, Progress, Schedule, SubsidiaryDayFacts, TaskRow, TaskStatus, TaskStep } from './daily-task.types';

const MIN = 60_000;

/**
 * Estado de un paso. `blocked` = el paso anterior aún no está listo: puede verse avance,
 * pero nunca se marca tarde (la hora límite real todavía no existe).
 */
function statusOf(done: boolean, doneCount: number, dueAt: Date, now: Date, blocked: boolean): TaskStatus {
  if (done) return 'done';
  if (!blocked && now.getTime() > dueAt.getTime()) return 'late';
  return doneCount > 0 ? 'partial' : 'pending';
}

/** Listo al llegar al porcentaje; con total 0 no queda nada que hacer (si el paso anterior ya terminó). */
const isDone = (p: Progress, s: Schedule, prevDone = true) => (p.total === 0 ? prevDone : Math.floor((p.done / p.total) * 100) >= s.completePct);

/**
 * Pasos de un consolidado (master/F2/aéreo/DHL). Cada paso se ancla a cuando terminó el anterior.
 * Las devoluciones NO son paso: no todos los DEX regresan a FedEx; solo se informan.
 */
export function consolidatedTasks(f: ConsolidatedFacts, s: Schedule, now: Date): TaskRow[] {
  const base = { refType: f.refType, refId: f.refId, consNumber: f.consNumber };
  const rows: TaskRow[] = [];
  const push = (step: TaskStep, p: Progress, dueAt: Date, done: boolean, blocked: boolean, doneAt: Date | null = p.last) =>
    rows.push({
      ...base, step, dueAt, status: statusOf(done, p.done, dueAt, now, blocked), doneCount: p.done, totalCount: p.total,
      doneAt: done ? doneAt : null, doneById: done ? p.lastById ?? null : null, doneByName: done ? p.lastByName ?? null : null,
    });

  rows.push({ ...base, step: 'upload', status: 'done', doneCount: f.guides, totalCount: f.guides, dueAt: f.uploadedAt, doneAt: f.uploadedAt, doneById: f.uploadedById, doneByName: f.uploadedByName });

  // Desembarque: a la hora configurada del día en que se subió; si se subió más tarde, 2 h después.
  let unloadDue = atLocalTime(localDay(f.uploadedAt), s.unloadingTime);
  if (f.uploadedAt.getTime() > unloadDue.getTime()) unloadDue = new Date(f.uploadedAt.getTime() + 120 * MIN);
  const unloaded = isDone(f.unloading, s);
  push('unloading', f.unloading, unloadDue, unloaded, false);

  // Salida a ruta: N min después del desembarque; si eso cae con el sistema apagado, al día siguiente.
  const unloadEnd = unloaded && f.unloading.last ? f.unloading.last : unloadDue;
  let dispatchDue = new Date(unloadEnd.getTime() + s.dispatchAfterUnloadMinutes * MIN);
  const endOfDay = atLocalTime(localDay(unloadEnd), s.activeTo);
  if (dispatchDue.getTime() > endOfDay.getTime()) dispatchDue = atLocalTime(addDays(localDay(unloadEnd), 1), s.dispatchNextDayTime);
  const dispatched = isDone(f.dispatch, s, unloaded);
  push('dispatch', f.dispatch, dispatchDue, dispatched, !unloaded);

  // Cierre: a la hora configurada del día de la primera salida.
  const closureDue = atLocalTime(localDay(f.dispatch.first ?? dispatchDue), s.closureTime);
  const closed = isDone(f.closure, s, dispatched);
  push('closure', f.closure, closureDue, closed, !dispatched);

  return rows;
}

/** Tareas que son de la sucursal en el día (no de un solo consolidado). */
export function subsidiaryTasks(subsidiaryId: string, f: SubsidiaryDayFacts, s: Schedule, now: Date): TaskRow[] {
  const base = { refType: 'subsidiary' as const, refId: subsidiaryId, consNumber: null, doneById: null };
  const row = (step: TaskStep, dueAt: Date, done: boolean, doneCount: number, totalCount: number, doneAt: Date | null, doneByName: string | null): TaskRow => ({
    ...base, step, dueAt, status: statusOf(done, doneCount, dueAt, now, false), doneCount, totalCount, doneAt: done ? doneAt : null, doneByName: done ? doneByName : null,
  });
  const due = (hhmm: string) => atLocalTime(f.day, hhmm);
  const after = (d: Date) => now.getTime() > d.getTime();

  const closureDue = due(s.closureTime);
  const closureDone = f.dispatchesTotal > 0 ? f.dispatchesClosed >= f.dispatchesTotal : after(closureDue);
  return [
    row('inventory_initial', due(s.inventoryInitialTime), !!f.inventoryInitialAt, f.inventoryInitialAt ? 1 : 0, 1, f.inventoryInitialAt, f.inventoryInitialBy),
    row('closure', closureDue, closureDone, f.dispatchesClosed, f.dispatchesTotal, f.lastClosureAt, null),
    row('inventory_final', due(s.inventoryFinalTime), !!f.inventoryFinalAt, f.inventoryFinalAt ? 1 : 0, 1, f.inventoryFinalAt, f.inventoryFinalBy),
  ];
}
