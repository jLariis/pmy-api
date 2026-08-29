import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { NormalizedEvent } from '../tracking-sync.types';

export interface ChargeableIncome {
  eventKey: string;
  incomeType: IncomeStatus;
  occurredAt: Date;
  exceptionCode: string;
  reason: string;
}

/**
 * Mirror de la lógica cobrable del legacy (shipments.service.ts:8628-8640), por evento:
 * DL→ENTREGADO; 07/RECHAZADO→NO_ENTREGADO; 08 acumulado ≥3→NO_ENTREGADO.
 * `existing08Count` = 08 ya persistidos del envío. Devuelve a lo sumo uno por evento.
 */
export function deriveChargeableIncomes(newEvents: NormalizedEvent[], existing08Count: number): ChargeableIncome[] {
  const out: ChargeableIncome[] = [];
  let count08 = existing08Count;
  // Orden cronológico para que la 3ra visita se cuente bien.
  const events = [...newEvents].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const e of events) {
    const ec = (e.exceptionCode ?? '').trim();
    if (e.status === ShipmentStatusType.ENTREGADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: 'ENTREGADO (DL)' });
    } else if (ec === '07' || e.status === ShipmentStatusType.RECHAZADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: `RECHAZADO (${ec || '07'})` });
    } else if (ec === '08') {
      count08++;
      if (count08 >= 3) {
        out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: '3ra VISITA' });
      }
    }
  }
  return out;
}
