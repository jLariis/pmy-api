import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from './enums/shipment-status-type.enum';

/**
 * Regla ÚNICA de Local Delay (LD). La usan los reportes (bodega, salidas a ruta), el
 * rastreo de guías y Tareas del día, para que nunca den números distintos.
 *
 * Una guía es LD si venció (su día de Hermosillo), no está entregada, no tuvo un DEX
 * válido (`LD_QUALIFYING_EXCEPTION_CODES`) en su día de vencimiento y —si la variante
 * lo pide— no tuvo ningún movimiento FedEx ese día. Mientras vence HOY es "posible LD".
 */
export type LdState = 'delivered' | 'closed' | 'ld' | 'possible_ld' | 'active';

export interface LdInput {
  status: string;
  /** 'today' = vence hoy (o en el rango que se revisa) · 'past' = ya venció · null = no aplica. */
  due: 'today' | 'past' | null;
  dexOnCommitDay: boolean;
  movedOnCommitDay: boolean;
  /** Reporte de bodega/rastreo: cualquier movimiento ese día salva el LD. Salidas a ruta: no. */
  requireNoMovement: boolean;
  /** Rastreo: los estatus terminales no entregados (devuelto, ocurre…) no son LD. Reportes: sí cuentan. */
  excludeClosed: boolean;
}

const DELIVERED = new Set<string>([
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
]);
const CLOSED = new Set<string>(TERMINAL_SHIPMENT_STATUSES.filter((s) => !DELIVERED.has(s)));

export const isDeliveredStatus = (status: string | null | undefined) => DELIVERED.has(String(status ?? '').toLowerCase());

export function classifyLd(i: LdInput): LdState {
  const status = String(i.status ?? '').toLowerCase();
  if (DELIVERED.has(status)) return 'delivered';
  if (i.excludeClosed && CLOSED.has(status)) return 'closed';
  if (!i.due) return 'active';
  if (i.dexOnCommitDay) return 'active';
  if (i.requireNoMovement && i.movedOnCommitDay) return 'active';
  return i.due === 'today' ? 'possible_ld' : 'ld';
}

const HER_OFFSET_MS = -7 * 3600 * 1000; // America/Hermosillo, sin horario de verano.

/** Día de negocio (YYYY-MM-DD) en Hermosillo de un instante. */
export const herDay = (x: Date | string): string => new Date(new Date(x).getTime() + HER_OFFSET_MS).toISOString().slice(0, 10);
