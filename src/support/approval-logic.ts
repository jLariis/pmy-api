/**
 * Lógica pura del flujo de aprobación de soporte (sin Nest/TypeORM).
 * Decisiones (2026-08-12): solo `mejora` requiere aprobación; basta 1 autorizador
 * de la zona; bloqueo duro para avanzar a estados de trabajo salvo override del
 * superadmin; rechazo marca el ticket como rechazado.
 */
export type ApprovalStatus = 'no_requiere' | 'pendiente' | 'aprobado' | 'rechazado';

export const SUPER_ROLES = ['superadmin', 'superamin'];

/** Tipos que requieren aprobación. Override por env `SUPPORT_APPROVAL_TYPES`. */
export function approvalTypes(): string[] {
  const raw = process.env.SUPPORT_APPROVAL_TYPES;
  if (raw) return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ['mejora'];
}

export function requiresApproval(tipo: string | null | undefined): boolean {
  return approvalTypes().includes((tipo ?? '').toLowerCase());
}

export function initialApprovalStatus(tipo: string | null | undefined): ApprovalStatus {
  return requiresApproval(tipo) ? 'pendiente' : 'no_requiere';
}

/** Estados del kanban que cuentan como "trabajo en curso" (gateados por aprobación). */
const WORKING_STATES = ['en_progreso', 'en_revision', 'completado'];

export function isWorkingState(estado: string | null | undefined): boolean {
  return WORKING_STATES.includes(estado ?? '');
}

export function isSuperRole(role: string | null | undefined): boolean {
  return SUPER_ROLES.includes((role ?? '').toString().toLowerCase());
}

/**
 * ¿Mover el ticket a `nextEstado` está bloqueado por aprobación pendiente?
 * Bloqueo duro para no-superadmins cuando el ticket está `pendiente` de aprobación
 * y se intenta avanzar a un estado de trabajo. El superadmin siempre puede (override).
 */
export function isBlockedByApproval(
  approvalStatus: string | null | undefined,
  nextEstado: string | null | undefined,
  isSuper: boolean,
): boolean {
  if (isSuper) return false;
  if (approvalStatus !== 'pendiente') return false;
  return isWorkingState(nextEstado);
}

/** ¿Puede el usuario aprobar/rechazar? Superadmin o autorizador de la zona. */
export function canApprove(isSuper: boolean, isZoneAuthorizer: boolean): boolean {
  return isSuper || isZoneAuthorizer;
}
