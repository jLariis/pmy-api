import type { CollectionAuditStatus } from '../zone/zone.types';

/** Estado de cobro de una recolección registrada: 31.5 no cobra; 0 cobros = falta; 2+ = duplicada. */
export function classifyCollectionAudit(c: { is315: boolean; activeIncomes: number }): CollectionAuditStatus {
  if (c.is315) return 'no_cobra_315';
  if (c.activeIncomes === 0) return 'sin_cobro';
  return c.activeIncomes === 1 ? 'cobrada' : 'duplicada';
}
