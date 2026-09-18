import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

/**
 * Motor de veredicto de un paquete: cruza el estatus (interno/FedEx) + historial + si estuvo en
 * consolidado + la fecha de la salida a ruta + la fecha del ingreso, y concluye si un
 * "entregado por FedEx" en realidad lo entregamos nosotros (cobro válido) o es un cobro dudoso.
 * Puro y testeable — no toca BD ni FedEx.
 */

export type VerdictLevel = 'ok' | 'warn' | 'danger';

export type VerdictCode =
  | 'delivered_by_us' // entregado por fedex PERO salió en nuestra ruta el día del ingreso
  | 'fedex_delivery_doubtful' // entregado por fedex, sin ruta ese día → cobro dudoso
  | 'our_delivery_ok' // entrega nuestra normal, respaldada
  | 'no_income_ok' // sin ingreso, sin problema
  | 'income_missing' // lo entregamos nosotros pero NO se cobró → falta cobrar
  | 'date_mismatch' // ingreso fechado en día sin evento
  | 'income_without_support' // cobro sin evento terminal que lo respalde
  | 'status_regressed' // tuvo estatus final y volvió a tránsito
  | 'unverified'; // entregado por fedex pero no se pudo confirmar contra FedEx

export type SuggestedAction =
  | { kind: 'none' }
  | { kind: 'fix_status'; to: ShipmentStatusType }
  | { kind: 'repair_income' }
  | { kind: 'delete_income' };

export interface Verdict {
  code: VerdictCode;
  level: VerdictLevel;
  title: string;
  evidence: string[];
  suggestedAction: SuggestedAction;
}

export interface VerdictInput {
  currentStatus: ShipmentStatusType | null;
  /** Historial de estatus (status + timestamp). */
  history: Array<{ status: string | null; timestamp: Date | string | null }>;
  /** ¿El paquete estuvo en un consolidado nuestro? */
  hasConsolidado: boolean;
  /** routeDate de la salida a ruta a la que pertenece el shipment (día de negocio). */
  routeDate: Date | string | null;
  /** Fecha del ingreso activo ligado (si existe). */
  incomeDate: Date | string | null;
  /** ¿Se pudo confirmar el estatus contra FedEx? false degrada el veredicto a "sin verificar". */
  fedexVerified: boolean;
}

/** Entregas HECHAS POR NOSOTROS: si no tienen ingreso, es un cobro que probablemente falta. */
const OUR_DELIVERY = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
]);

/** Estatus terminales (entrega o no-entrega resuelta) que justifican/anclan un cobro. */
const TERMINAL = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
]);

const dayKey = (d: Date | string | null): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

const isFedexDelivered = (i: VerdictInput): boolean =>
  i.currentStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX ||
  (i.history || []).some((h) => h.status === ShipmentStatusType.ENTREGADO_POR_FEDEX);

export function computeVerdict(i: VerdictInput): Verdict {
  const hasIncome = !!i.incomeDate;
  const terminalEvents = (i.history || []).filter((h) => h.status && TERMINAL.has(String(h.status)));
  const currentTerminal = i.currentStatus ? TERMINAL.has(String(i.currentStatus)) : false;

  // --- Caso #2: entregado por FedEx con ingreso → analizar ruta+fecha ---
  if (isFedexDelivered(i) && hasIncome) {
    if (!i.fedexVerified) {
      return {
        code: 'unverified',
        level: 'warn',
        title: 'Sin verificar contra FedEx',
        evidence: ['No se pudo confirmar el estatus con FedEx; revisa manualmente.'],
        suggestedAction: { kind: 'none' },
      };
    }
    const sameDay = !!i.routeDate && !!i.incomeDate && dayKey(i.routeDate) === dayKey(i.incomeDate);
    if (sameDay) {
      const evidence = ['Aparece como entregado por FedEx.'];
      if (i.hasConsolidado) evidence.push('Estuvo en un consolidado nuestro.');
      evidence.push(`Salió en nuestra ruta el ${dayKey(i.routeDate)}.`);
      evidence.push(`El ingreso se generó el mismo día (${dayKey(i.incomeDate)}).`);
      evidence.push('Conclusión: lo entregamos nosotros; el cobro es válido.');
      return {
        code: 'delivered_by_us',
        level: 'ok',
        title: 'Lo entregamos nosotros — cobro válido',
        evidence,
        suggestedAction: { kind: 'fix_status', to: ShipmentStatusType.ENTREGADO },
      };
    }
    return {
      code: 'fedex_delivery_doubtful',
      level: 'danger',
      title: 'Cobro dudoso — sin ruta ese día',
      evidence: [
        'Aparece como entregado por FedEx.',
        i.routeDate
          ? `Salió en ruta el ${dayKey(i.routeDate)}, pero el ingreso es del ${dayKey(i.incomeDate)}.`
          : 'No salió en ninguna ruta nuestra.',
        'Conclusión: probablemente lo entregó FedEx; el cobro no debería existir.',
      ],
      suggestedAction: { kind: 'delete_income' },
    };
  }

  // --- Cobro sin ningún evento terminal que lo respalde ---
  if (hasIncome && terminalEvents.length === 0) {
    return {
      code: 'income_without_support',
      level: 'danger',
      title: 'Cobro sin entrega que lo respalde',
      evidence: ['Hay ingreso pero el paquete no tiene ninguna entrega ni rechazo.'],
      suggestedAction: { kind: 'delete_income' },
    };
  }

  // --- Fecha del cobro desalineada con los días en que se movió el paquete ---
  if (hasIncome) {
    const eventDays = new Set((i.history || []).map((h) => dayKey(h.timestamp)).filter(Boolean));
    if (eventDays.size > 0 && !eventDays.has(dayKey(i.incomeDate))) {
      return {
        code: 'date_mismatch',
        level: 'warn',
        title: 'Fecha del cobro no coincide',
        evidence: ['El ingreso está fechado en un día en que el paquete no se movió.'],
        suggestedAction: { kind: 'none' },
      };
    }
  }

  // --- Retroceso: tuvo estatus final y volvió a tránsito ---
  if (!currentTerminal && terminalEvents.length > 0) {
    return {
      code: 'status_regressed',
      level: 'warn',
      title: 'Volvió a tránsito tras un estatus final',
      evidence: ['Tuvo un estatus final pero volvió a aparecer en tránsito.'],
      suggestedAction: { kind: 'none' },
    };
  }

  if (hasIncome) {
    return { code: 'our_delivery_ok', level: 'ok', title: 'Entrega respaldada', evidence: [], suggestedAction: { kind: 'none' } };
  }

  // Sin ingreso: si LO ENTREGAMOS NOSOTROS, probablemente falta cobrarlo (el "qué podría faltar").
  if (i.currentStatus && OUR_DELIVERY.has(String(i.currentStatus))) {
    return {
      code: 'income_missing',
      level: 'warn',
      title: 'Falta cobrar — entregado sin ingreso',
      evidence: ['El paquete se entregó pero no tiene ingreso registrado. Genera el cobro si corresponde.'],
      suggestedAction: { kind: 'repair_income' },
    };
  }

  return { code: 'no_income_ok', level: 'ok', title: 'Sin cobro', evidence: [], suggestedAction: { kind: 'none' } };
}
