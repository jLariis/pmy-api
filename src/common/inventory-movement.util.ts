/**
 * Renglones de historial que deja el INVENTARIO físico ("Paquete confirmado en inventario físico…").
 *
 * No son movimiento del paquete: solo dicen que se contó en bodega. Si se cuentan como movimiento,
 * hacer inventario el día que vence un paquete le "quita" el LD (reporte LD de inventario, Tareas
 * del día, checkLdStatus y "movido ayer" del reporte de rutas). Regla única para todos esos lectores.
 *
 * Los renglones nuevos llevan `source = 'inventory'`; los históricos se reconocen por la nota.
 */
export const INVENTORY_STATUS_SOURCE = 'inventory';

const INVENTORY_NOTE_RE = /confirmado en inventario f[ií]sico/i;

/** ¿El renglón de historial es una confirmación de inventario (no un movimiento)? */
export function isInventoryConfirmationRow(row: { source?: string | null; notes?: string | null } | null | undefined): boolean {
  if (!row) return false;
  if (row.source === INVENTORY_STATUS_SOURCE) return true;
  return INVENTORY_NOTE_RE.test(row.notes ?? '');
}

/**
 * Condición SQL (MySQL) que deja SOLO renglones que son movimiento real (excluye inventario).
 * `_` en la nota cubre "físico"/"fisico" sin depender de la intercalación.
 */
export function realMovementSql(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return `((${p}source IS NULL OR ${p}source <> '${INVENTORY_STATUS_SOURCE}') AND (${p}notes IS NULL OR ${p}notes NOT LIKE '%confirmado en inventario f_sico%'))`;
}
