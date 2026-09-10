/**
 * Nuevo costo tras quitar/poner el 2º a bordo. Idempotente: si el estado pedido (`enabled`)
 * coincide con lo que ya trae la carga (`alreadyIncluded`), no cambia nada; nunca baja de 0.
 */
export function computeSecondAbordDelta(
  currentCost: number,
  secondAbordAmount: number,
  enabled: boolean,
  alreadyIncluded: boolean,
): number {
  if (enabled === alreadyIncluded) return Number(currentCost.toFixed(2));
  const next = enabled ? currentCost + secondAbordAmount : currentCost - secondAbordAmount;
  return Math.max(0, Number(next.toFixed(2)));
}
