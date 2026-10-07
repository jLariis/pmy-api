import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { realDeliveryScan } from './phantom-delivery.util';

/**
 * Cron legacy de FedEx (master y F2): el estatus final se decide con TODOS los escaneos (y el
 * encabezado DL), pero el historial solo guarda los escaneos que pasan el candado de
 * pre-registro. Si FedEx entregó ANTES de que se subiera la guía (31.5 de La Paz, 07-oct), la
 * guía quedaba ENTREGADA sin su fila de entrega en shipment_status.
 *
 * Regla: si el estatus cambia y ninguna fila del historial (vieja o recién insertada) lo
 * respalda, se guarda el escaneo FedEx que lo respalda, con el estatus final.
 */

interface ScanEvent {
  date?: string | Date | null;
  eventType?: string | null;
  derivedStatusCode?: string | null;
  exceptionCode?: string | null;
}

const DELIVERED = new Set<string>([ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX]);

/** ¿Hace falta grabar un escaneo de respaldo para el estatus final? */
export function needsBackingHistory(input: {
  prevStatus: string | null | undefined;
  finalStatus: string | null | undefined;
  historyStatuses: Iterable<string>;
}): boolean {
  const { prevStatus, finalStatus } = input;
  if (!finalStatus || finalStatus === prevStatus) return false;
  // SOLO entregas: es el único estatus que gana sobre el escudo de tiempo con un evento viejo.
  // Un DEX anterior al registro (guías sin fila interna) NO se respalda: ensuciaría el historial
  // (p. ej. sumaría visitas 08) con eventos de cuando el paquete aún no era nuestro.
  if (!DELIVERED.has(finalStatus)) return false;
  for (const s of input.historyStatuses) if (s === finalStatus) return false;
  return true;
}

/**
 * Escaneo FedEx que respalda `finalStatus`: para entregas, la entrega REAL más reciente (nunca
 * una fantasma); para lo demás, el último escaneo que mapea a ese estatus. `null` si no hay.
 */
export function selectBackingScan<T extends ScanEvent>(scanEvents: readonly T[], finalStatus: string): T | null {
  if (DELIVERED.has(finalStatus)) return realDeliveryScan([...scanEvents]);
  let best: T | null = null;
  for (const e of scanEvents ?? []) {
    const mapped = mapFedexStatusToLocalStatus(e.derivedStatusCode || '', e.exceptionCode || '');
    if (mapped !== finalStatus) continue;
    if (!best || new Date(e.date as any).getTime() >= new Date(best.date as any).getTime()) best = e;
  }
  return best;
}
