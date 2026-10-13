/**
 * F2 sobre una guía que el master del MISMO consolidado ya subió como paquete (consNumber +
 * sucursal): la guía es carga, así que el paquete se elimina del master (regla del negocio
 * desde el wizard; se perdió en e6ac30a, 07-oct-2026, y dejó paquete + carga dobles).
 * Solo aplica al mismo consolidado: registros de consolidados anteriores nunca se tocan.
 * Si el paquete ya se trabajó (salió a ruta o cobró), no se borra: se avisa para revisarlo.
 */
export type MasterRemovalDecision = { action: 'remove' } | { action: 'keep'; reason: string };

export function decideMasterRemoval(input: { hasDispatch: boolean; hasActiveIncome: boolean }): MasterRemovalDecision {
  if (input.hasDispatch) return { action: 'keep', reason: 'ya salió a ruta como paquete' };
  if (input.hasActiveIncome) return { action: 'keep', reason: 'ya tiene ingreso como paquete' };
  return { action: 'remove' };
}
