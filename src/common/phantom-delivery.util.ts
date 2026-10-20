/**
 * ENTREGA FANTASMA (decisión del usuario 2026-10-06, caso 383915660048): FedEx a veces marca
 * "DL - Delivered" a mitad del trayecto (ej. 30-09 16:56 en origen) y DESPUÉS el paquete sigue
 * moviéndose (sale del origen, llega a otra estación, va en camino, sube a reparto). Esa
 * "entrega" no es real: no debe marcar ENTREGADO ni generar cobro.
 *
 * Regla: un evento de entrega es fantasma si existe un evento POSTERIOR de movimiento de FedEx.
 *
 * ENTREGADO ES FINAL (regla del usuario, reforzada 2026-10-19, ruta Cabo 439565284120): si el
 * encabezado de FedEx (latestStatusDetail) dice "Delivered", NINGUNA entrega es fantasma; y los
 * escaneos 67/44 (proveedor de confianza = nosotros / estación local) nunca cuentan como
 * movimiento: FedEx los manda con la hora adelantada (~1 h) y anulaban entregas reales sin cobro.
 * Esos escaneos se siguen guardando en el historial (trazabilidad); solo no anulan la entrega.
 */

/** Evento de escaneo mínimo (FedEx scanEvents o eventos normalizados). */
export interface ScanLike {
  date?: string | Date | null;
  eventType?: string | null;
  derivedStatusCode?: string | null;
  exceptionCode?: string | null;
}

/** Encabezado de FedEx (latestStatusDetail) mínimo. */
export interface DeliveryHeaderLike {
  code?: string | null;
  derivedCode?: string | null;
}

/** Códigos de MOVIMIENTO: si aparecen después de una entrega, la entrega no fue real. */
const MOVEMENT_CODES = new Set(['PU', 'DP', 'AR', 'AF', 'IT', 'OD']);
/** Escaneos nuestros / de estación local: nunca son movimiento de FedEx. */
const VENDOR_SCAN_CODES = new Set(['67', '44']);

const code = (e: ScanLike, k: 'eventType' | 'derivedStatusCode') => String(e?.[k] ?? '').trim().toUpperCase();
const time = (e: ScanLike) => {
  const t = e?.date ? new Date(e.date as any).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
};

export function isDeliveryScan(e: ScanLike): boolean {
  return code(e, 'eventType') === 'DL' || code(e, 'derivedStatusCode') === 'DL';
}

export function isMovementScan(e: ScanLike): boolean {
  if (VENDOR_SCAN_CODES.has(String(e?.exceptionCode ?? '').trim())) return false;
  return MOVEMENT_CODES.has(code(e, 'eventType')) || MOVEMENT_CODES.has(code(e, 'derivedStatusCode'));
}

/** ¿El encabezado de FedEx confirma la entrega? Entonces es final: ninguna entrega es fantasma. */
export function isHeaderDelivered(header?: DeliveryHeaderLike | null): boolean {
  return String(header?.code ?? '').toUpperCase() === 'DL' || String(header?.derivedCode ?? '').toUpperCase() === 'DL';
}

/** ¿Esta entrega es fantasma? (hay movimiento posterior en `events` y FedEx no la confirma). */
export function isPhantomDelivery(events: ScanLike[], delivery: ScanLike, header?: DeliveryHeaderLike | null): boolean {
  if (!isDeliveryScan(delivery) || isHeaderDelivered(header)) return false;
  const t = time(delivery);
  if (!Number.isFinite(t)) return false;
  return (events ?? []).some((e) => isMovementScan(e) && time(e) > t);
}

/**
 * Entrega REAL más reciente: el DL más nuevo que NO va seguido de movimiento. `null` si no hay
 * entregas o todas son fantasma.
 */
export function realDeliveryScan<T extends ScanLike>(events: T[], header?: DeliveryHeaderLike | null): T | null {
  let best: T | null = null;
  for (const e of events ?? []) {
    if (!isDeliveryScan(e) || isPhantomDelivery(events, e, header)) continue;
    if (!best || time(e) > time(best)) best = e;
  }
  return best;
}

/** ¿Hay alguna entrega en los eventos y TODAS son fantasma? */
export function onlyPhantomDeliveries(events: ScanLike[], header?: DeliveryHeaderLike | null): boolean {
  const dls = (events ?? []).filter(isDeliveryScan);
  return dls.length > 0 && dls.every((e) => isPhantomDelivery(events, e, header));
}

/** Instantes (ms) de las entregas FANTASMA, para reconocer su evento/historial. */
export function phantomDeliveryTimes(events: ScanLike[], header?: DeliveryHeaderLike | null): Set<number> {
  const out = new Set<number>();
  for (const e of events ?? []) {
    if (isPhantomDelivery(events, e, header)) out.add(time(e));
  }
  return out;
}
