import { ForbiddenException } from '@nestjs/common';
import { allowedSubsidiaryIds, isAuthorizer } from './maintenance.permissions';

export interface ScopeUser {
  userId?: string;
  role?: string;
  permissions?: string[];
  subsidiaryIds?: string[];
  name?: string;
  lastName?: string;
  email?: string;
}

/**
 * El usuario solo opera sobre registros de sus sucursales. Superadmin/owner ven todo y el
 * autorizador (Edgardo) también, porque autoriza órdenes de todas las sucursales.
 */
export function assertSubsidiaryScope(user: ScopeUser | undefined, subsidiaryId: string): void {
  if (isAuthorizer(user)) return;
  const allowed = allowedSubsidiaryIds(user);
  if (allowed && !allowed.includes(subsidiaryId)) {
    throw new ForbiddenException('Solo puedes consultar datos de tus sucursales asignadas.');
  }
}

export const userDisplayName = (u?: { name?: string | null; lastName?: string | null; email?: string | null } | null): string =>
  [u?.name, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Sistema';
