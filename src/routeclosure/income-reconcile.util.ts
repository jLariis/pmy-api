import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { NoVanIncomeFields } from './novan-income.util';

/**
 * Ingresos SHIPMENT que ya tiene una guía en la BD, resumidos para la decisión.
 * `dex` es el (primer) Income NO_ENTREGADO con su id y el día Hermosillo de su `date`.
 */
export interface ExistingShipmentIncome {
  entregado: boolean;
  dex?: { id: string; day: string };
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
 *  - NO_ENTREGADO (DEX): (1) ya hay ENTREGADO → none (no degradar); (2) ya hay DEX → none
 *    (idempotente); (3) si no → create NO_ENTREGADO con el código (backfill).
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
  if (existing.dex) return { type: 'none' };
  return {
    type: 'create',
    incomeType: IncomeStatus.NO_ENTREGADO,
    nonDeliveryStatus: decision.nonDeliveryStatus,
  };
}
