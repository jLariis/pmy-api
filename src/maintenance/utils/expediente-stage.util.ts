/** Columna del tablero. */
export type ExpedienteStage = 'por_revisar' | 'cotizando' | 'por_autorizar' | 'en_proceso' | 'terminado' | 'rechazada' | 'cancelado';
/** Paso activo del expediente (stepper). */
export type ExpedienteStep = 'solicitud' | 'revision' | 'cotizaciones' | 'ordenes' | 'cierre' | 'terminado';
/** Quién tiene la pelota: compras = Gerardo; autorizador = Edgardo. */
export type WaitingOn = 'compras' | 'autorizador' | 'proveedor' | null;

export interface ExpedienteStageInput {
  requestStatus: string;
  quotesCount: number;
  /** Órdenes de compra de la solicitud (puede haber una por proveedor). */
  orders: Array<{ status: string; rejectionReason?: string | null }>;
}

export interface ExpedienteStageResult {
  stage: ExpedienteStage;
  step: ExpedienteStep;
  nextStep: string;
  waitingOn: WaitingOn;
  rejected: boolean;
}

/**
 * Una solicitud = un expediente (renglones + cotizaciones + N órdenes). Deriva la columna del tablero,
 * el paso activo y qué sigue, en lenguaje simple.
 */
export function expedienteStage({ requestStatus, quotesCount, orders }: ExpedienteStageInput): ExpedienteStageResult {
  const r = (stage: ExpedienteStage, step: ExpedienteStep, nextStep: string, waitingOn: WaitingOn, rejected = false) =>
    ({ stage, step, nextStep, waitingOn, rejected });

  if (requestStatus === 'cancelada') return r('cancelado', 'terminado', 'Solicitud cancelada', null);
  if (requestStatus === 'rechazada') return r('rechazada', 'terminado', 'Compras rechazó la solicitud', null);
  if (requestStatus === 'por_revisar') return r('por_revisar', 'revision', 'Compras revisará tu solicitud', 'compras');

  const active = orders.filter((o) => o.status !== 'cancelada');
  if (active.length) {
    if (active.every((o) => o.status === 'completada')) return r('terminado', 'terminado', 'Compra terminada', null);
    if (active.some((o) => o.status === 'borrador' && o.rejectionReason)) {
      return r('cotizando', 'ordenes', 'Una orden fue rechazada: corrígela y vuelve a mandarla, o elige otro proveedor', 'compras', true);
    }
    if (active.some((o) => o.status === 'pendiente' || o.status === 'borrador')) {
      return r('por_autorizar', 'ordenes', active.length > 1 ? 'Esperando la autorización de las órdenes' : 'Esperando la autorización de la orden', 'autorizador');
    }
    if (active.some((o) => o.status === 'autorizada')) {
      return r('en_proceso', 'ordenes', 'Envía las órdenes autorizadas a sus proveedores', 'compras');
    }
    return r('en_proceso', 'cierre', 'Cierra cada orden cuando se reciba lo comprado', 'proveedor');
  }
  if (requestStatus === 'completada') return r('terminado', 'terminado', 'Compra terminada', null);

  if (quotesCount === 0) return r('cotizando', 'cotizaciones', 'Pide y captura las cotizaciones de los proveedores', 'compras');
  if (quotesCount === 1) return r('cotizando', 'cotizaciones', 'Agrega otra cotización para comparar o genera la orden', 'compras');
  return r('cotizando', 'cotizaciones', 'Compara por partida y genera las órdenes', 'compras');
}
