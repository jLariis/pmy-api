import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { deliveredByFedex } from './status-origin.util';

/** Estatus terminales/cobrables (entrega o no-entrega resuelta) que justifican/anclan un cobro. */
const TERMINAL = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
]);

export interface AnomalyInput {
  currentStatus: ShipmentStatusType | null;
  /** Historial de estatus (status + timestamp). */
  history: Array<{ status: string | null; timestamp: Date | string | null }>;
  /** Ingreso ligado (si existe). */
  income: { date: Date | string | null } | null;
  /** Fecha del último evento de estatus (ISO). */
  statusDate: string | null;
}

export interface Anomaly {
  code: 'date_mismatch' | 'status_regressed' | 'income_without_support' | 'delivered_by_fedex';
  label: string;
}

const dayKey = (d: Date | string | null): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

/**
 * Detecta anomalías analizando el estatus actual, su historial y el ingreso ligado. Puro y testeable.
 *  - date_mismatch: el ingreso está fechado en un día distinto al del evento de estatus.
 *  - status_regressed: el estatus actual NO es terminal, pero el historial tuvo un evento terminal
 *    (entrega/DEX07/rechazo/devolución) — el paquete "retrocedió".
 *  - income_without_support: hay ingreso pero el historial nunca tuvo un evento terminal que lo respalde.
 */
export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const out: Anomaly[] = [];
  const terminalEvents = (input.history || []).filter((h) => h.status && TERMINAL.has(String(h.status)));
  const currentTerminal = input.currentStatus ? TERMINAL.has(String(input.currentStatus)) : false;

  if (input.income && input.statusDate && dayKey(input.income.date) !== dayKey(input.statusDate)) {
    out.push({
      code: 'date_mismatch',
      label:
        'La fecha del cobro no coincide con el día en que se movió el paquete. Corrige la fecha del ingreso para que caiga en el día correcto.',
    });
  }

  if (!currentTerminal && terminalEvents.length > 0) {
    out.push({
      code: 'status_regressed',
      label:
        'El paquete ya tenía un estatus final (entregado, rechazado o devuelto) pero volvió a aparecer en tránsito. Verifica cuál es el estatus real.',
    });
  }

  if (input.income && terminalEvents.length === 0) {
    out.push({
      code: 'income_without_support',
      label:
        'Se generó un cobro pero el paquete no tiene ninguna entrega ni rechazo que lo respalde. Revisa si de verdad debe cobrarse o elimínalo.',
    });
  }

  // Cobro de una entrega que hizo FedEx, no nosotros: ENTREGADO_POR_FEDEX no debe generar ingreso.
  if (input.income && deliveredByFedex(input.currentStatus, input.history)) {
    out.push({
      code: 'delivered_by_fedex',
      label:
        'El paquete lo entregó FedEx, no nosotros. Normalmente este cobro no debería existir; considera eliminarlo.',
    });
  }

  return out;
}
