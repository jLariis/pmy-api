import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { isoWeekKey, dex08DayKey } from 'src/common/dex08-week.util';
import { NormalizedEvent } from '../tracking-sync.types';

export interface ChargeableIncome {
  eventKey: string;
  incomeType: IncomeStatus;
  occurredAt: Date;
  exceptionCode: string;
  reason: string;
}

/**
 * Mirror de la lógica cobrable del legacy (shipments.service.ts:8593-8605), por evento:
 * DL→ENTREGADO; 07/RECHAZADO→NO_ENTREGADO; 08 → NO_ENTREGADO SOLO cuando se juntan
 * **3 DÍAS distintos con 08 en la MISMA semana ISO (lun–dom)** (ver dex08-week.util). El
 * conteo es por semana y por DÍA distinto (no por evento ni corrido): varios 08 del mismo
 * día — o el mismo 08 re-arribado — cuentan como uno, para no cobrar "con 1 solo 08".
 * `existing08Dates` = fechas de los 08 ya persistidos del envío. Devuelve a lo sumo uno por evento.
 */
export function deriveChargeableIncomes(newEvents: NormalizedEvent[], existing08Dates: Date[]): ChargeableIncome[] {
  const out: ChargeableIncome[] = [];
  // Por semana ISO, el conjunto de DÍAS distintos con 08, sembrado con los ya persistidos.
  const weekDays = new Map<string, Set<string>>();
  const weekSet = (d: Date): Set<string> => {
    const k = isoWeekKey(d);
    let set = weekDays.get(k);
    if (!set) { set = new Set(); weekDays.set(k, set); }
    return set;
  };
  for (const d of existing08Dates) weekSet(d).add(dex08DayKey(d));
  // Orden cronológico para que el "3er día de la semana" se identifique bien.
  const events = [...newEvents].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const e of events) {
    const ec = (e.exceptionCode ?? '').trim();
    if (e.status === ShipmentStatusType.ENTREGADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: 'ENTREGADO (DL)' });
    } else if (ec === '07' || e.status === ShipmentStatusType.RECHAZADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: `RECHAZADO (${ec || '07'})` });
    } else if (ec === '08') {
      const set = weekSet(e.occurredAt);
      const day = dex08DayKey(e.occurredAt);
      if (set.has(day)) continue; // día ya contado → no suma ni re-dispara
      set.add(day);
      if (set.size === 3) {
        out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: '3ra VISITA (misma semana)' });
      }
    }
  }
  return out;
}
