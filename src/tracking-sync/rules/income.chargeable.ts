import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { isoWeekKey } from 'src/common/dex08-week.util';
import { NormalizedEvent } from '../tracking-sync.types';

export interface ChargeableIncome {
  eventKey: string;
  incomeType: IncomeStatus;
  occurredAt: Date;
  exceptionCode: string;
  reason: string;
}

/**
 * Mirror de la lógica cobrable del legacy (shipments.service.ts:8604-8616), por evento:
 * DL→ENTREGADO; 07/RECHAZADO→NO_ENTREGADO; 08 → NO_ENTREGADO SOLO cuando se juntan
 * **3 eventos 08 en la MISMA semana ISO (lun–dom)** (ver dex08-week.util). El conteo es
 * por semana, no corrido: `existing08Dates` = fechas de los 08 ya persistidos del envío.
 * Devuelve a lo sumo uno por evento.
 */
export function deriveChargeableIncomes(newEvents: NormalizedEvent[], existing08Dates: Date[]): ChargeableIncome[] {
  const out: ChargeableIncome[] = [];
  // Conteo de 08 por semana ISO, sembrado con los 08 ya persistidos.
  const week08 = new Map<string, number>();
  for (const d of existing08Dates) {
    const k = isoWeekKey(d);
    week08.set(k, (week08.get(k) ?? 0) + 1);
  }
  // Orden cronológico para que el "3ro de la semana" se identifique bien.
  const events = [...newEvents].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const e of events) {
    const ec = (e.exceptionCode ?? '').trim();
    if (e.status === ShipmentStatusType.ENTREGADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: 'ENTREGADO (DL)' });
    } else if (ec === '07' || e.status === ShipmentStatusType.RECHAZADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: `RECHAZADO (${ec || '07'})` });
    } else if (ec === '08') {
      const k = isoWeekKey(e.occurredAt);
      const c = (week08.get(k) ?? 0) + 1;
      week08.set(k, c);
      if (c === 3) {
        out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: '3ra VISITA (misma semana)' });
      }
    }
  }
  return out;
}
