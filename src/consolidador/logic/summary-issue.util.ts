import type { SubsidiarySummary, SummaryLevel } from '../zone/zone.types';

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * "Qué revisar primero" de una sucursal: la diferencia de dinero más grande (falta cobrar o
 * cobrado de más); si no hay, lo pendiente de revisar (recolecciones / No VAN sin cobro,
 * diferencias del conteo) o si falta pegar el conteo.
 */
export function buildTopIssue(
  s: Omit<SubsidiarySummary, 'topIssue' | 'level'>,
  money: (amount: number) => string,
): { topIssue: string; level: SummaryLevel } {
  if (s.missing.amount > 0 || s.extra.amount > 0) {
    if (s.missing.amount >= s.extra.amount) {
      return { topIssue: `${n(s.missing.count, 'guía falta', 'guías faltan')} por cobrar (${money(s.missing.amount)})`, level: 'bad' };
    }
    const label = s.doubles > 0 && s.doubles >= s.extra.count ? 'cobradas como paquete y como carga' : 'cobradas de más';
    const one = label.replace('cobradas', 'cobrada');
    return { topIssue: `${n(s.extra.count, `guía ${one}`, `guías ${label}`)} (${money(s.extra.amount)})`, level: 'bad' };
  }
  if (s.novan.withoutCharge > 0) return { topIssue: `${n(s.novan.withoutCharge, 'No VAN', 'No VAN')} sin cobro`, level: 'warn' };
  if (s.collections.withoutCharge > 0) return { topIssue: `${n(s.collections.withoutCharge, 'recolección', 'recolecciones')} sin cobro`, level: 'warn' };
  if (!s.lastManualCount) return { topIssue: 'Falta pegar el conteo manual', level: 'none' };
  if (s.lastManualCount.differences > 0) {
    return { topIssue: `${n(s.lastManualCount.differences, 'diferencia', 'diferencias')} en el último conteo manual`, level: 'warn' };
  }
  return { topIssue: 'Nada pendiente', level: 'ok' };
}
