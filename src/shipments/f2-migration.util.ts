import { isFinalShipmentStatus } from 'src/common/enums/shipment-status-type.enum';

/** Ventana para considerar "el mismo paquete" al pasarlo a carga F2. */
export const F2_MIGRATION_DAYS = 30;

export interface MigrationCandidate {
  status?: string | null;
  active?: boolean | number | null;
  createdAt?: Date | string | null;
  subsidiaryId?: string | null;
}

/**
 * ¿Un paquete normal (shipment) existente se PASA a carga F2 al subir la F2?
 *
 * Bug 2026-10-07 (Hermosillo/La Paz): la migración tomaba la guía en CUALQUIER sucursal y
 * estado y la clonaba (estatus, consolidado e historial) → la carga nueva nacía DEVUELTA A
 * FEDEX con el consolidado viejo, la salida a ruta la rechazaba y el registro devuelto se
 * borraba de su consolidado. Un estatus final (devuelto/entregado) termina la vida del
 * registro: la guía que vuelve en otra F2 es un REGISTRO NUEVO.
 *
 * Solo se migra si es de la MISMA sucursal, activo, reciente y NO está en estatus final.
 */
export function canMigrateShipmentToCharge(
  original: MigrationCandidate | null | undefined,
  ctx: { subsidiaryId: string; now?: Date; days?: number },
): boolean {
  if (!original) return false;
  if (original.active === false || original.active === 0) return false;
  if (!original.subsidiaryId || original.subsidiaryId !== ctx.subsidiaryId) return false;
  if (isFinalShipmentStatus(original.status)) return false;
  const created = original.createdAt ? new Date(original.createdAt).getTime() : NaN;
  if (!Number.isFinite(created)) return false;
  const now = (ctx.now ?? new Date()).getTime();
  return now - created <= (ctx.days ?? F2_MIGRATION_DAYS) * 86_400_000;
}
