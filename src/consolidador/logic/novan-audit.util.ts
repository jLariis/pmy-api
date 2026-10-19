import { noVanIncomeDecision, type NoVanFedexOutcome } from 'src/routeclosure/novan-income.util';
import type { NoVanStatus } from '../zone/zone.types';

/**
 * Estado de cobro de un No VAN (guía que el chofer reportó en el cierre y no venía en archivos).
 * Mismo criterio que el cierre (`noVanIncomeDecision`): si FedEx dice que cobra y no hay cobro, falta.
 */
export function classifyNoVan(i: {
  is315: boolean;
  activeIncomes: number;
  existsAsShipment: boolean;
  fedex: NoVanFedexOutcome | null;
}): { status: NoVanStatus; suggestedKind: 'pod' | 'dex' | null } {
  if (i.existsAsShipment) return { status: 'es_paquete', suggestedKind: null };
  if (i.is315) return { status: 'no_cobra_315', suggestedKind: null };
  if (i.activeIncomes > 0) return { status: 'cobrada', suggestedKind: null };
  if (!i.fedex || !i.fedex.resolved) return { status: 'sin_verificar', suggestedKind: null };
  const decision = noVanIncomeDecision(i.fedex);
  if (!decision) return { status: 'en_transito', suggestedKind: null };
  return { status: 'sin_cobro', suggestedKind: i.fedex.delivered ? 'pod' : 'dex' };
}

/** Lo que dice FedEx de un No VAN, en llano. */
export function noVanFedexLabel(o: NoVanFedexOutcome | null): string | null {
  if (!o || !o.resolved) return null;
  if (o.delivered) return 'Entregada';
  if (o.dexCode) return `No entregada (DEX${o.dexCode})`;
  return 'En tránsito';
}
