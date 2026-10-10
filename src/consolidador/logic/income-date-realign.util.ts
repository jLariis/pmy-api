import { IncomeStatus } from '../../common/enums/income-status.enum';
import { toHermosilloDateString } from '../../common/utils';
import { IncomeHistoryRow, isInternalRow } from '../../routeclosure/closure-income-event.util';

/** Ingreso a revisar (mínimo para decidir su fecha correcta). */
export interface RealignIncomeInput {
  incomeType: IncomeStatus | string;
  nonDeliveryStatus?: string | null;
  date: Date | string;
}

export interface RealignDecision {
  /** Fecha correcta = `shipment_status.timestamp` del evento FedEx que generó el ingreso. */
  correctDate: Date;
  /** Hora/fecha del evento usado (texto corto para la vista previa). */
  basis: string;
}

/** 00:00 Hermosillo exacto (07:00:00.000Z): la marca de un ingreso fechado con el día de la ruta. */
export function isDayStartAnchored(date: Date | string): boolean {
  const d = date instanceof Date ? date : new Date(date);
  return !isNaN(d.getTime()) && d.getUTCHours() === 7 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Decide la fecha correcta de un ingreso de guía FedEx fechado a las 00:00 del día de la ruta
 * (bug del cierre, Loreto 2026-10-06): la fecha es la del evento FedEx guardado en el historial,
 * tal cual. Pura, sin I/O. Devuelve null si no hay evento claro (se deja como está para revisión).
 *  - ENTREGADO: el evento "entregado" de FedEx más reciente.
 *  - NO_ENTREGADO: el evento con el mismo código DEX; primero el del mismo día del ingreso, si no
 *    el primero posterior a la fecha del ingreso.
 */
export function resolveIncomeEventDate(income: RealignIncomeInput, history: IncomeHistoryRow[]): RealignDecision | null {
  const incomeDate = toDate(income.date as any);
  if (!incomeDate) return null;
  const rows = (history ?? [])
    .filter((r) => !isInternalRow(r))
    .map((r) => ({ ...r, at: toDate(r.timestamp) }))
    .filter((r): r is typeof r & { at: Date } => !!r.at);

  if (String(income.incomeType) === IncomeStatus.ENTREGADO) {
    const delivered = rows.filter((r) => String(r.status ?? '').toLowerCase() === 'entregado');
    if (!delivered.length) return null;
    const latest = delivered.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
    return { correctDate: latest.at, basis: 'Entregado (FedEx)' };
  }

  const code = (income.nonDeliveryStatus ?? '').trim();
  if (!code) return null;
  const dex = rows
    .filter((r) => (r.exceptionCode ?? '').trim() === code)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!dex.length) return null;
  const incomeDay = toHermosilloDateString(incomeDate);
  const sameDay = dex.filter((r) => toHermosilloDateString(r.at) === incomeDay);
  const pick = sameDay.length ? sameDay[sameDay.length - 1] : dex.find((r) => r.at.getTime() >= incomeDate.getTime());
  return pick ? { correctDate: pick.at, basis: `DEX ${code} (FedEx)` } : null;
}
