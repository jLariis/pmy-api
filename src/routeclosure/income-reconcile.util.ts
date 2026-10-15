import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { NoVanIncomeFields } from './novan-income.util';

/**
 * Ingresos SHIPMENT que ya tiene una guía en la BD, resumidos para la decisión.
 * `dex` es el (primer) Income NO_ENTREGADO con su id y el día Hermosillo de su `date`.
 */
export interface ExistingShipmentIncome {
  entregado: boolean;
  dex?: { id: string; day: string };
  /**
   * Días (YYYY-MM-DD Hermosillo) de TODOS los DEX vivos. Con ellos un DEX ya cobrado solo bloquea
   * otro de su MISMA semana (igual que el cron). Sin la lista, cualquier DEX bloquea (compatibilidad).
   */
  dexDays?: string[];
}

/** Lunes (YYYY-MM-DD) de la semana lun–dom de un día YYYY-MM-DD. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface IncomeReconcileInput {
  /** Decisión de ingreso derivada del último estatus FedEx (reuso de noVanIncomeDecision). */
  decision: NoVanIncomeFields | null;
  /** Día calendario Hermosillo (YYYY-MM-DD) del evento FedEx cobrable, o null si no se conoce. */
  deliveryDay: string | null;
  existing: ExistingShipmentIncome;
}

export type IncomeReconcileAction =
  | { type: 'none' }
  | { type: 'create'; incomeType: IncomeStatus; nonDeliveryStatus: string | null }
  | { type: 'supersede'; incomeId: string };

/**
 * Decide QUÉ hacer con el ingreso de un shipment tras reconciliar su estatus FedEx en el
 * cierre a ruta. Pura (sin I/O). Reglas (el ORDEN importa):
 *  - Sin decisión (en tránsito / sin resolver) → none.
 *  - ENTREGADO: (1) ya hay ENTREGADO → none (idempotente; un DEX rezagado del mismo día NO se
 *    toca aquí, para no borrar filas ni duplicar ENTREGADO); (2) hay DEX del MISMO día →
 *    supersede esa fila (ENTREGADO gana); (3) si no → create ENTREGADO (backfill o cross-day,
 *    donde el DEX de otro día se conserva).
 *  - NO_ENTREGADO (DEX): (1) ya hay ENTREGADO → none (no degradar); (2) ya hay DEX de la MISMA
 *    semana → none (idempotente; un DEX de otra semana es otro cobro, igual que en el cron);
 *    (3) si no → create NO_ENTREGADO con el código (backfill).
 */
export function reconcileShipmentIncomeAction(input: IncomeReconcileInput): IncomeReconcileAction {
  const { decision, deliveryDay, existing } = input;
  if (!decision) return { type: 'none' };

  if (decision.incomeType === IncomeStatus.ENTREGADO) {
    if (existing.entregado) return { type: 'none' };
    if (existing.dex && deliveryDay && existing.dex.day === deliveryDay) {
      return { type: 'supersede', incomeId: existing.dex.id };
    }
    return { type: 'create', incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null };
  }

  // NO_ENTREGADO (DEX)
  if (existing.entregado) return { type: 'none' };
  if (existing.dex) {
    // Sin día del evento o sin la lista de días no se puede comparar semana: se conserva el
    // comportamiento previo (cualquier DEX bloquea) para no arriesgar un doble cobro.
    if (!deliveryDay || !existing.dexDays) return { type: 'none' };
    const week = mondayOf(deliveryDay);
    if (existing.dexDays.some((d) => mondayOf(d) === week)) return { type: 'none' };
  }
  return {
    type: 'create',
    incomeType: IncomeStatus.NO_ENTREGADO,
    nonDeliveryStatus: decision.nonDeliveryStatus,
  };
}
