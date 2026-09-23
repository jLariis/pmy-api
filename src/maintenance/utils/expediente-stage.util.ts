import type { PoStatus } from './po-state.util';

/** Columna del tablero. */
export type ExpedienteStage = 'cotizando' | 'por_autorizar' | 'en_taller' | 'terminado' | 'cancelado';
/** Paso activo del expediente (stepper). */
export type ExpedienteStep = 'solicitud' | 'cotizaciones' | 'autorizacion' | 'envio' | 'cierre' | 'terminado';
/** Quién tiene la pelota. */
export type WaitingOn = 'captura' | 'autorizador' | 'proveedor' | null;

export interface ExpedienteStageInput {
  requestStatus: string;
  quotesCount: number;
  po: { status: PoStatus | string; rejectionReason?: string | null } | null;
}

export interface ExpedienteStageResult {
  stage: ExpedienteStage;
  step: ExpedienteStep;
  nextStep: string;
  waitingOn: WaitingOn;
  rejected: boolean;
}

/**
 * Un mantenimiento = un expediente (solicitud + cotizaciones + orden). Deriva, a partir de los
 * estados de la solicitud y su orden, en qué columna del tablero va, cuál es el paso activo y
 * qué sigue — en lenguaje simple para el usuario.
 */
export function expedienteStage({ requestStatus, quotesCount, po }: ExpedienteStageInput): ExpedienteStageResult {
  const r = (stage: ExpedienteStage, step: ExpedienteStep, nextStep: string, waitingOn: WaitingOn, rejected = false) =>
    ({ stage, step, nextStep, waitingOn, rejected });

  if (requestStatus === 'cancelada' || po?.status === 'cancelada') return r('cancelado', 'terminado', 'Mantenimiento cancelado', null);
  if (requestStatus === 'completada' || po?.status === 'completada') return r('terminado', 'terminado', 'Servicio terminado', null);

  switch (po?.status) {
    case 'pendiente':
      return r('por_autorizar', 'autorizacion', 'Esperando la autorización de la orden', 'autorizador');
    case 'autorizada':
      return r('en_taller', 'envio', 'Envía la orden al proveedor', 'captura');
    case 'enviada':
      return r('en_taller', 'cierre', 'Cierra el servicio cuando la unidad salga del taller', 'proveedor');
    case 'borrador':
    case 'rechazada':
      return po.rejectionReason
        ? r('cotizando', 'cotizaciones', 'La orden fue rechazada: corrígela y vuelve a mandarla, o elige otra cotización', 'captura', true)
        : r('cotizando', 'cotizaciones', 'Manda la orden a autorización', 'captura');
  }

  if (quotesCount === 0) return r('cotizando', 'cotizaciones', 'Captura las cotizaciones de los proveedores', 'captura');
  if (quotesCount === 1) return r('cotizando', 'cotizaciones', 'Agrega otra cotización para comparar o elige esta', 'captura');
  return r('cotizando', 'cotizaciones', 'Compara las cotizaciones y elige la mejor', 'captura');
}
