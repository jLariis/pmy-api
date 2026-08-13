import { IncomeStatus } from 'src/common/enums/income-status.enum';

/** Estatus FedEx autoritativo de una guía "No VAN", para decidir su ingreso en el cierre. */
export interface NoVanFedexOutcome {
  trackingNumber: string;
  delivered: boolean;
  dexCode: string | null;
  resolved: boolean; // false si FedEx no devolvió datos / hubo error
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
 *
 * Devuelve `null` cuando NO se debe generar ingreso.
 */
export function noVanIncomeDecision(outcome: NoVanFedexOutcome): NoVanIncomeFields | null {
  if (!outcome.resolved) return null;
  if (!outcome.delivered && !outcome.dexCode) return null;

  return {
    incomeType: outcome.delivered ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO,
    nonDeliveryStatus: outcome.delivered ? null : outcome.dexCode,
  };
}
