import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { hasWeekWithThreeDex08Days } from 'src/common/dex08-week.util';

/** Estatus FedEx autoritativo de una guía "No VAN", para decidir su ingreso en el cierre. */
export interface NoVanFedexOutcome {
  trackingNumber: string;
  delivered: boolean;
  dexCode: string | null;
  resolved: boolean; // false si FedEx no devolvió datos / hubo error
  /** Instantes de TODOS los 08 conocidos de la guía; solo se usan si `dexCode === '08'`. */
  dex08Dates?: Date[];
}

/** Campos de ingreso derivados de un outcome cobrable. */
export interface NoVanIncomeFields {
  incomeType: IncomeStatus;
  nonDeliveryStatus: string | null;
}

/**
 * Decide si un paquete "No VAN" (en ruta NO 31.5) genera ingreso y con qué estatus.
 *
 * Regla — espejo del flujo DHL: el ingreso se crea SIEMPRE con costo completo + código;
 * qué CUENTA lo decide `charge_rule` en lectura. Aquí solo decidimos si hay código que
 * aplicar:
 *  - Sin validación FedEx (`resolved=false`, no encontrado/caído) ⇒ no cobra (`null`).
 *  - En tránsito / sin entregar ni DEX (`!delivered && !dexCode`) ⇒ sin código ⇒ no cobra.
 *  - Entregado ⇒ `ENTREGADO`, sin `nonDeliveryStatus`.
 *  - No entregado con DEX ⇒ `NO_ENTREGADO`, `nonDeliveryStatus = dexCode`.
 *  - DEX 08 solo cobra con 3 DÍAS distintos con 08 en la MISMA semana ISO (misma regla
 *    que el cron y el motor nuevo; ver dex08-week.util). Si no, no se genera ingreso.
 *
 * Devuelve `null` cuando NO se debe generar ingreso.
 */
export function noVanIncomeDecision(outcome: NoVanFedexOutcome): NoVanIncomeFields | null {
  if (!outcome.resolved) return null;
  if (!outcome.delivered && !outcome.dexCode) return null;
  if (!outcome.delivered && outcome.dexCode === '08' && !hasWeekWithThreeDex08Days(outcome.dex08Dates ?? [])) {
    return null;
  }

  return {
    incomeType: outcome.delivered ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO,
    nonDeliveryStatus: outcome.delivered ? null : outcome.dexCode,
  };
}
