import { isFinalShipmentStatus } from 'src/common/enums/shipment-status-type.enum';

/**
 * Selección del envío FedEx "vivo" cuando un número de guía trae varios `trackResults`.
 *
 * FedEx repite números: guías RECICLADAS (otra vida, otra secuencia) y DOS ETIQUETAS del mismo
 * envío con escaneos distintos. Regla (restaurada 2026-10-21; así estaba en el cron el 17-feb y
 * se cambió el 18-feb, commit 40dd4c1, por "secuencia más alta"): gana el envío con el ESCANEO MÁS
 * RECIENTE; la secuencia del UniqueID solo desempata. "Secuencia más alta" fallaba con dos
 * etiquetas (522209574500, Cabo 20-oct: la etiqueta 2461329000 quieta vs 2461327000 con DEX08/DL).
 * Fuente ÚNICA: motor nuevo, cron, registro de guías, reportes y cierre.
 */

/** Secuencia numérica del UniqueID ("2461327000~522209574500~FX" → 2461327000). */
export function generationSeq(result: any): number {
  return parseInt(result?.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0', 10) || 0;
}

/** Instante del escaneo más reciente del envío (0 si no tiene). No asume el orden de scanEvents. */
export function lastScanTime(result: any): number {
  let max = 0;
  for (const e of result?.scanEvents ?? []) {
    const t = e?.date ? new Date(e.date).getTime() : NaN;
    if (!isNaN(t) && t > max) max = t;
  }
  return max;
}

const compareActive = (a: any, b: any) => lastScanTime(b) - lastScanTime(a) || generationSeq(b) - generationSeq(a);

/** Copia ordenada: el envío vivo primero. Para el código que después lee `results[0]`. */
export function orderByActiveGeneration<T>(results: T[] | null | undefined): T[] {
  return [...(results ?? [])].sort(compareActive);
}

/** El envío vivo (o null si no hay resultados). */
export function pickActiveGeneration<T>(results: T[] | null | undefined): T | null {
  if (!results?.length) return null;
  if (results.length === 1) return results[0];
  return orderByActiveGeneration(results)[0];
}

/**
 * Referencia para consultar FedEx. Solo se AMARRA al envío guardado (`fedexUniqueId` +
 * `carrierCode`) cuando la guía ya está cerrada (entregada / devuelta): ahí no debe brincar a un
 * reciclaje futuro. Abierta, se consulta por número para que FedEx devuelva todos los envíos y
 * `pickActiveGeneration` elija el vivo (si la primera elección fue la etiqueta quieta, se corrige).
 */
export function trackingRefFor(entity: {
  trackingNumber: string;
  fedexUniqueId?: string | null;
  carrierCode?: string | null;
  status?: string | null;
}): { trackingNumber: string; fedexUniqueId?: string; carrierCode?: string } {
  if (!isFinalShipmentStatus(entity.status)) return { trackingNumber: entity.trackingNumber };
  return {
    trackingNumber: entity.trackingNumber,
    ...(entity.fedexUniqueId ? { fedexUniqueId: entity.fedexUniqueId } : {}),
    ...(entity.carrierCode ? { carrierCode: entity.carrierCode } : {}),
  };
}
