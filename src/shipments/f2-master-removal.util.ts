import { isFinalShipmentStatus } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';

/**
 * F2 sobre una guía que el master ya subió como paquete: la guía es carga, así que el paquete
 * se elimina del master (regla del negocio desde el wizard; se perdió en e6ac30a, 07-oct-2026,
 * y dejó paquete + carga dobles).
 *
 * El F2 llega DESPUÉS del master y con OTRO consolidado (el del correo), así que no se exige
 * el mismo consNumber. Para no borrar registros de antes por error, solo cuenta el paquete
 * subido EL MISMO DÍA (Hermosillo) en la misma sucursal: uno de otro día se deja intacto.
 * Si el paquete del día ya se trabajó (ruta, cobro o estatus final), no se borra: se avisa.
 */
export type MasterRemovalDecision =
  | { action: 'remove' }
  | { action: 'keep'; reason: string }
  | { action: 'skip' };

export function isSameHermosilloDay(a: Date | string, b: Date | string): boolean {
  return toHermosilloDateString(new Date(a)) === toHermosilloDateString(new Date(b));
}

export function decideMasterRemoval(input: {
  hasDispatch: boolean;
  hasActiveIncome: boolean;
  status: string | null | undefined;
  createdAt: Date | string;
  now: Date;
}): MasterRemovalDecision {
  if (!input.createdAt || !isSameHermosilloDay(input.createdAt, input.now)) return { action: 'skip' };
  if (input.hasDispatch) return { action: 'keep', reason: 'ya salió a ruta como paquete' };
  if (input.hasActiveIncome) return { action: 'keep', reason: 'ya tiene ingreso como paquete' };
  if (isFinalShipmentStatus(input.status)) return { action: 'keep', reason: 'ya está entregado o devuelto como paquete' };
  return { action: 'remove' };
}
