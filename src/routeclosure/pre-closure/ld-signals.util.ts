import { classifyLd, herDay, isDeliveredStatus, LdState } from 'src/common/ld-rule.util';

export interface LdSignalsInput {
  status: string;
  commitDateTime: Date | string | null | undefined;
  /** Día de negocio de la ruta (YYYY-MM-DD, Hermosillo). */
  routeDay: string;
  /** Días (Hermosillo) con cualquier evento FedEx/DHL de la guía. */
  eventDays: Set<string>;
  /** Días (Hermosillo) con un DEX que cancela el LD (`LD_QUALIFYING_EXCEPTION_CODES`). */
  dexDays: Set<string>;
}

export interface LdSignals {
  /** No tuvo ningún evento en el día de la ruta. */
  noMovement: boolean;
  /** Vence el día de la ruta. */
  dueToday: boolean;
  ldState: LdState;
}

/**
 * Señales de riesgo de LD que el pre-cierre marca por guía. El estado sale de la regla ÚNICA
 * `classifyLd` con la variante de Salidas a ruta (solo un DEX válido el día de vencimiento
 * quita el riesgo; el movimiento no), para que cuadre con los reportes y Tareas del día.
 */
export function buildLdSignals(i: LdSignalsInput): LdSignals {
  const commitDay = i.commitDateTime ? herDay(i.commitDateTime) : null;
  const dueToday = commitDay === i.routeDay;
  const due = dueToday ? 'today' : commitDay && commitDay < i.routeDay ? 'past' : null;

  const ldState = classifyLd({
    status: i.status,
    due,
    dexOnCommitDay: !!commitDay && i.dexDays.has(commitDay),
    movedOnCommitDay: false,
    requireNoMovement: false,
    excludeClosed: false,
  });

  return {
    noMovement: !isDeliveredStatus(i.status) && !i.eventDays.has(i.routeDay),
    dueToday,
    ldState,
  };
}
