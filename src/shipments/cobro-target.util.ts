/**
 * Resolución de destino de un cobro (payment) del paso "Cobros" del wizard.
 *
 * Una guía puede vivir como `shipment` normal o como `charge_shipment` (carga F2 / 31.5).
 * El archivo de cobros trae solo el tracking, así que hay que decidir a cuál entidad
 * pegarle el payment. Esta función es PURA: recibe los candidatos ya buscados en BD y
 * aplica la precedencia acordada, sin tocar la base.
 *
 * Precedencia (de mayor a menor):
 *  1. shipment por `{ tracking, consNumber }`
 *  2. charge_shipment por `{ tracking, consNumber }`
 *  3. shipment por `{ tracking }`        (fallback: guías/cargas sin consNumber)
 *  4. charge_shipment por `{ tracking }` (fallback)
 *
 * Regla: shipment siempre gana a charge para el MISMO nivel de match, y el match por
 * consNumber (más específico) siempre gana al match por tracking-solo. Nunca se aplica a
 * ambas entidades: el primero en la precedencia se lleva el cobro (evita doble cobro).
 */
export type CobroTargetKind = 'shipment' | 'charge';
export type CobroTargetSource = 'cons' | 'tracking';

export interface CobroTargetDecision {
  kind: CobroTargetKind;
  source: CobroTargetSource;
}

/**
 * Candidatos encontrados en BD para un tracking. `undefined` = no se buscó todavía;
 * `null` = se buscó y no existe. La función trata ambos como "no candidato".
 */
export interface CobroCandidates {
  shipmentByCons?: unknown | null;
  chargeByCons?: unknown | null;
  shipmentByTracking?: unknown | null;
  chargeByTracking?: unknown | null;
}

export function resolveCobroTarget(c: CobroCandidates): CobroTargetDecision | null {
  if (c.shipmentByCons) return { kind: 'shipment', source: 'cons' };
  if (c.chargeByCons) return { kind: 'charge', source: 'cons' };
  if (c.shipmentByTracking) return { kind: 'shipment', source: 'tracking' };
  if (c.chargeByTracking) return { kind: 'charge', source: 'tracking' };
  return null;
}
