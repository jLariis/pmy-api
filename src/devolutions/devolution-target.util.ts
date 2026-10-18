import { ShipmentStatusType, isFinalShipmentStatus } from 'src/common/enums/shipment-status-type.enum';

/**
 * A qué REGISTRO de la guía le toca una devolución (lógica PURA, sin I/O).
 *
 * Una guía puede vivir en varios registros (cada consolidado nuevo crea uno). Antes la devolución
 * se ligaba al más nuevo y marcaba "devuelto a FedEx" en TODOS. Caso 384096861505 (16-oct-2026):
 * registros del 15 y del 16; la devolución era del 15 (DEX17) pero se aplicó también al del 16,
 * que iba en ruta y FedEx entregó ese mismo día.
 *
 * Reglas:
 *  - La persona elige el registro; si no, se sugiere el que NO va en una ruta abierta, que aún no
 *    tiene desenlace final, y el más nuevo de ésos.
 *  - Se marca el elegido y los MÁS VIEJOS que sigan abiertos; nunca uno más nuevo (es otro flujo).
 */

export type DevolutionRecordKind = 'shipment' | 'charge';

export interface DevolutionRecordRoute {
  folio: string | null;
  /** yyyy-MM-dd (día de la ruta). */
  routeDate: string | null;
  /** La salida ya tiene cierre. */
  closed: boolean;
}

export interface DevolutionRecord {
  kind: DevolutionRecordKind;
  id: string;
  createdAt: Date;
  status: ShipmentStatusType | string;
  consolidatedId: string | null;
  consNumber: string | null;
  /** yyyy-MM-dd del consolidado. */
  consDate: string | null;
  subsidiaryId: string | null;
  subsidiaryName: string | null;
  /** Última salida a ruta en la que estuvo (null = nunca salió). */
  lastRoute: DevolutionRecordRoute | null;
  /** Destinatario, para reconocer el paquete físico. */
  recipientName?: string | null;
  recipientAddress?: string | null;
  recipientCity?: string | null;
  recipientZip?: string | null;
  /** Ingreso "entregado" vigente de este registro (o de la guía sin registro ligado). */
  entregadoIncome: { id: string; cost: number } | null;
}

export const recordKey = (r: { kind: DevolutionRecordKind; id: string }) => `${r.kind}:${r.id}`;

/** El registro va hoy en una salida a ruta que todavía no se cierra. */
export function isInOpenRoute(r: DevolutionRecord): boolean {
  return r.status === ShipmentStatusType.EN_RUTA && !!r.lastRoute && !r.lastRoute.closed;
}

const newestFirst = (a: DevolutionRecord, b: DevolutionRecord) => b.createdAt.getTime() - a.createdAt.getTime();

/** Registro sugerido para la devolución (null si no hay registros). */
export function suggestDevolutionRecord(records: DevolutionRecord[]): DevolutionRecord | null {
  if (!records.length) return null;
  const sorted = [...records].sort(newestFirst);
  const notInRoute = sorted.filter((r) => !isInOpenRoute(r));
  const open = notInRoute.filter((r) => !isFinalShipmentStatus(r.status));
  return open[0] ?? notInRoute[0] ?? sorted[0];
}

/**
 * Registros que la devolución marca como "devuelto a FedEx": el elegido y los más viejos que no
 * tengan desenlace final. Uno ya devuelto/entregado no se toca.
 */
export function recordsToMark(records: DevolutionRecord[], chosen: DevolutionRecord): DevolutionRecord[] {
  return records
    .filter((r) => recordKey(r) === recordKey(chosen) || r.createdAt.getTime() < chosen.createdAt.getTime())
    .filter((r) => !isFinalShipmentStatus(r.status))
    .sort(newestFirst);
}
