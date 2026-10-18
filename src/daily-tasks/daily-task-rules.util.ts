import { addDays } from '../ops-alerts/ops-alerts.util';
import { OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { SubsidiaryDayFacts, TaskRow, TaskStatus, TaskStep } from './daily-task.types';

/** Días que el cron recalcula cada 5 min: hoy y los 2 anteriores (cierres y devoluciones llegan al día siguiente). */
export const liveDays = (today: string): string[] => [today, addDays(today, -1), addDays(today, -2)];

/** Al abrir un día pasado de la última semana se recalcula; los más viejos se leen del historial guardado. */
export const refreshOnView = (day: string, today: string): boolean => day <= today && day >= addDays(today, -7);

type Saved = { id?: string; status: TaskStatus; notifiedStatus?: TaskStatus | null };

/**
 * Fila a guardar. `notifiedStatus` es lo último que se avisó: nace igual al estado (no se
 * avisa lo que ya estaba) y solo lo mueve el notificador, aunque la pantalla guarde primero.
 */
export function mergeTaskRow<T extends Saved>(existing: T | null, next: TaskRow): TaskRow & { id?: string; notifiedStatus: TaskStatus } {
  return { ...(existing ?? {}), ...next, notifiedStatus: existing ? (existing.notifiedStatus ?? existing.status) : next.status } as TaskRow & { id?: string; notifiedStatus: TaskStatus };
}

/** Filas listas cuyo "listo" no se ha avisado. Un paso que vuelve a medias y luego a listo no se repite. */
export const doneToNotify = <T extends Saved>(rows: T[]): T[] => rows.filter((r) => r.status === 'done' && r.notifiedStatus !== 'done');

/** La sucursal trabajó ese día: llegaron consolidados, hubo salidas o se hizo algún inventario. */
export const subsidiaryHasOperation = (f: Pick<SubsidiaryDayFacts, 'dispatchesTotal' | 'inventoryInitialAt' | 'inventoryFinalAt'>, consolidatedCount: number): boolean =>
  consolidatedCount > 0 || f.dispatchesTotal > 0 || !!f.inventoryInitialAt || !!f.inventoryFinalAt;

const STEP_FLAG: Record<TaskStep, keyof OpsAlertSubsidiary> = {
  upload: 'stepUpload',
  unloading: 'stepUnloading',
  dispatch: 'stepDispatch',
  closure: 'stepClosure',
  devolutions: 'stepDevolutions',
  inventory_initial: 'stepInventoryInitial',
  inventory_final: 'stepInventory',
};

/** Los interruptores por sucursal apagan los AVISOS de un paso; la pantalla siempre lo muestra. */
export const stepAlertsEnabled = (cfg: Partial<OpsAlertSubsidiary> | null | undefined, step: TaskStep): boolean => cfg?.[STEP_FLAG[step]] !== false;

/**
 * Un atraso que se registra por primera vez solo avisa si es de hoy y se venció con el
 * servidor ya arriba: al desplegar o reiniciar no sale una ráfaga de lo que ya venía vencido.
 */
export const shouldAlertNew = (day: string, today: string, dueAt: Date, bootAt: Date): boolean => day === today && dueAt.getTime() >= bootAt.getTime();

/** Identidad de pieza: en DHL la guía maestra se comparte; cada pieza es su dhlUniqueId. */
export const pieceKeyOf = (g: { trackingNumber: string; dhlUniqueId?: string | null }): string => (g.dhlUniqueId || g.trackingNumber).trim();
