import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';

/** Fila mínima de shipment_status para el cálculo de lastOpTime. */
export interface OpStatusRow {
  timestamp: Date | string;
  status: string;
}

/** Ancla de una salida a ruta: día operativo declarado (`routeDate`) + momento de captura. */
export interface DispatchAnchor {
  routeDate: Date | string;
  createdAt: Date | string;
}

const OPERATIONAL = new Set<string>([
  String(ShipmentStatusType.PENDIENTE),
  String(ShipmentStatusType.EN_BODEGA),
  String(ShipmentStatusType.EN_RUTA),
]);

const EN_RUTA = String(ShipmentStatusType.EN_RUTA);

/**
 * Tolerancia para emparejar el evento EN_RUTA de una salida a ruta con SU despacho: la
 * salida estampa el historial con `new Date()` justo tras guardar el `PackageDispatch`, así
 * que su `timestamp` y `dispatch.createdAt` caen a milisegundos uno del otro. 60s es holgado
 * y jamás confundiría un EN_RUTA real de FedEx (que no coincide al segundo con una captura).
 */
const MATCH_TOLERANCE_MS = 60_000;

/**
 * `lastOpTime` EFECTIVO para el Time Shield del motor nuevo (NO toca legacy ni la escritura).
 *
 * Problema (caso 383295956902): la salida a ruta estampa el evento EN_RUTA con la hora de
 * CAPTURA (`now`), no con el día operativo de la ruta (`routeDate`). En una ruta RETROACTIVA
 * (hoy se captura la ruta de ayer) ese EN_RUTA queda "más nuevo" que cualquier evento real de
 * FedEx de ese día; el Time Shield lo blinda y el paquete se queda EN_RUTA para siempre aunque
 * FedEx ya diga cliente_no_disponible / entregado.
 *
 * Fix: al calcular lastOpTime, el EN_RUTA de una ruta retroactiva se re-ancla al INICIO de su
 * día operativo (`routeDate`, ya persistido como 07:00Z). Rutas del MISMO día conservan su hora
 * real (sin regresión). Solo se re-anclan rutas hacia atrás (routeDate < día de captura).
 */
export function computeEffectiveLastOpTime(
  rows: OpStatusRow[],
  dispatches: DispatchAnchor[] = [],
): number {
  const backdated = dispatches
    .map((d) => ({ routeDate: new Date(d.routeDate), createdAt: new Date(d.createdAt) }))
    // Solo retroactivas: el día operativo declarado es ANTERIOR al día de captura (Hermosillo).
    .filter((d) => toHermosilloDateString(d.routeDate) < toHermosilloDateString(d.createdAt))
    .map((d) => ({ captureMs: d.createdAt.getTime(), anchorMs: d.routeDate.getTime() }));

  let max = 0;
  for (const r of rows) {
    const status = String(r.status).toLowerCase();
    if (!OPERATIONAL.has(status)) continue;
    let eff = new Date(r.timestamp).getTime();
    if (status === EN_RUTA && backdated.length) {
      const match = backdated.find((b) => Math.abs(b.captureMs - eff) <= MATCH_TOLERANCE_MS);
      if (match) eff = match.anchorMs;
    }
    if (eff > max) max = eff;
  }
  return max;
}
