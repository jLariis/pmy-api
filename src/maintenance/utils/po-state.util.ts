import { BadRequestException } from '@nestjs/common';

export type PoStatus = 'borrador' | 'pendiente' | 'autorizada' | 'rechazada' | 'enviada' | 'completada' | 'cancelada';

export const PO_STATUSES: PoStatus[] = ['borrador', 'pendiente', 'autorizada', 'rechazada', 'enviada', 'completada', 'cancelada'];

/** Transiciones válidas de la orden de compra. `autorizada → pendiente` = modificada por quien no autoriza. */
const TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  borrador: ['pendiente'],
  pendiente: ['autorizada', 'rechazada'],
  rechazada: ['borrador'],
  autorizada: ['enviada', 'cancelada', 'pendiente'],
  enviada: ['enviada', 'completada', 'cancelada'],
  completada: [],
  cancelada: [],
};

export const canTransition = (from: PoStatus, to: PoStatus): boolean => TRANSITIONS[from]?.includes(to) ?? false;

export function assertTransition(from: PoStatus, to: PoStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(`No se puede pasar la orden de "${from}" a "${to}".`);
  }
}

/** Quien captura edita solo en borrador; el autorizador también en pendiente o autorizada. */
export const canEditItems = (status: PoStatus, isAuthorizer: boolean): boolean =>
  status === 'borrador' || (isAuthorizer && (status === 'pendiente' || status === 'autorizada'));

/** Solo se eliminan (baja lógica) órdenes que nunca se autorizaron. */
export const canDelete = (status: PoStatus): boolean => status === 'borrador' || status === 'rechazada';
