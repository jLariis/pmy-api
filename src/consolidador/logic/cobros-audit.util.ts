import { dex08DayKey } from 'src/common/dex08-week.util';

/**
 * Auditoría de cobros de una GUÍA FedEx de envío dentro de una semana ISO (lun–dom).
 * Los `events` e `incomes` YA vienen filtrados a la ventana de la semana; los `incomes`
 * solo activos. Detecta descuadres en las dos direcciones y por regla:
 *  - FALTA (missing): debería cobrar y no cobra.
 *  - SOBRA (extra):   cobra y no debería (p. ej. DEX08 sin 3 visitas).
 *
 * Reglas (mismo criterio que el cobro real):
 *  - ENTREGADO   → un Income 'entregado'.
 *  - NO_ENTREGADO → un Income 'no_entregado', justificado por un 07/rechazado O por
 *    **3 días calendario distintos con 08** en la semana (ver dex08-week.util). 07 y 08
 *    comparten incomeType, así que el lado no-entregado se evalúa junto.
 */

export type CobroRule = 'entregado' | 'no_entregado';
export type CobroDiscrepancy = 'missing' | 'extra';

export interface AuditEvent {
  status: string | null;         // shipment_status.status
  exceptionCode: string | null;  // '07' | '08' | ...
  timestamp: Date;
}
export interface AuditIncome {
  incomeType: string | null;         // 'entregado' | 'no_entregado'
  nonDeliveryStatus: string | null;  // '07' | '08' | ''
  date: Date;
}
export interface ShipmentAuditInput {
  trackingNumber: string;
  isF2: boolean;
  currentStatus: string | null; // shipment.status
  events: AuditEvent[];
  incomes: AuditIncome[];
}
export interface CobroFinding {
  trackingNumber: string;
  rule: CobroRule;
  subCode: '07' | '08' | null; // subregla para no_entregado
  discrepancy: CobroDiscrepancy;
  reason: string;
  isF2: boolean;
  count: number; // nº de ingresos de más (extra); 1 en missing
}

const low = (s: string | null | undefined) => (s ?? '').toString().trim().toLowerCase();

export function auditShipmentCobros(input: ShipmentAuditInput): CobroFinding[] {
  const { trackingNumber, isF2 } = input;
  const findings: CobroFinding[] = [];
  const mk = (rule: CobroRule, discrepancy: CobroDiscrepancy, subCode: '07' | '08' | null, reason: string, count = 1) =>
    findings.push({ trackingNumber, rule, subCode, discrepancy, reason, isF2, count });

  const current = low(input.currentStatus);

  // --- Señales de la semana ---
  // Entregado en bodega también es entrega final y cobra ENTREGADO (misma regla que pick-up).
  const warehouseEvent = input.events.some((e) => low(e.status) === 'entregado_en_bodega');
  const deliveredEvent = warehouseEvent || input.events.some((e) => low(e.status) === 'entregado');
  const rejected07 = input.events.some((e) => (e.exceptionCode ?? '').trim() === '07' || low(e.status) === 'rechazado');
  const days08 = new Set(
    input.events.filter((e) => (e.exceptionCode ?? '').trim() === '08').map((e) => dex08DayKey(e.timestamp)),
  );
  const dex08Qualifies = days08.size >= 3;
  const expectedNonDel = rejected07 || dex08Qualifies;

  const entregadoIncomes = input.incomes.filter((i) => low(i.incomeType) === 'entregado').length;
  const noEntIncomes = input.incomes.filter((i) => low(i.incomeType) === 'no_entregado');

  // --- Regla ENTREGADO ---
  const entregadoJustified = deliveredEvent || current === 'entregado' || current === 'entregado_en_bodega';
  if (deliveredEvent && entregadoIncomes === 0) {
    mk('entregado', 'missing', null, warehouseEvent ? 'Entregado en bodega sin ingreso' : 'Entregado en la semana sin ingreso');
  }
  const entExtra = entregadoIncomes - (entregadoJustified ? 1 : 0);
  if (entExtra > 0) {
    mk('entregado', 'extra', null,
      entregadoJustified ? 'Ingreso entregado duplicado en la semana' : 'Ingreso entregado sin entrega en la semana',
      entExtra);
  }

  // --- Regla NO ENTREGADO (07 / DEX08) ---
  if (expectedNonDel && noEntIncomes.length === 0) {
    const subCode: '07' | '08' = rejected07 ? '07' : '08';
    mk('no_entregado', 'missing', subCode,
      rejected07 ? 'Rechazo 07 sin ingreso' : '3ra visita (3 días con 08) sin ingreso');
  }
  const nonDelExtra = noEntIncomes.length - (expectedNonDel ? 1 : 0);
  if (nonDelExtra > 0) {
    // Atribuye la subregla al código del ingreso cuando existe (08 = DEX08 sin 3 visitas).
    const codes = noEntIncomes.map((i) => (i.nonDeliveryStatus ?? '').trim());
    const subCode: '07' | '08' | null = codes.includes('08') ? '08' : codes.includes('07') ? '07' : null;
    const reason = expectedNonDel
      ? 'Cobro no_entregado duplicado en la semana'
      : subCode === '08'
        ? 'Cobro DEX08 sin 3 visitas (días distintos) en la semana'
        : 'Cobro no_entregado sin justificación (ni 07 ni 3 días 08)';
    mk('no_entregado', 'extra', subCode, reason, nonDelExtra);
  }

  return findings;
}
