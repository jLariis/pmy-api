/** Códigos RBAC del módulo (ver `auth/rbac/permission-catalog.ts`). */
export const MTTO = {
  programacion: 'mttoVehiculos.programacion',
  historial: 'mttoVehiculos.historial',
  solicitudes: 'mttoVehiculos.solicitudes',
  ordenes: 'mttoVehiculos.ordenes',
  catalogos: 'mttoVehiculos.catalogos',
  autorizar: 'mttoVehiculos.autorizar',
} as const;

/** Lectura de catálogos: cualquiera que trabaje en el módulo. */
export const MTTO_READ = [MTTO.catalogos, MTTO.solicitudes, MTTO.ordenes, MTTO.autorizar];

/** ¿Puede autorizar órdenes? Superadmin (bypass habitual) o permiso concedido (Edgardo Lugo). */
export function isAuthorizer(user: { role?: string; permissions?: string[] } | null | undefined): boolean {
  const role = (user?.role || '').toLowerCase();
  return role === 'superadmin' || role === 'superamin' || (user?.permissions ?? []).includes(MTTO.autorizar);
}

/** Sucursales visibles para el usuario (null = todas). Igual criterio que SubsidiaryScopeGuard. */
export function allowedSubsidiaryIds(user: { role?: string; subsidiaryIds?: string[] } | null | undefined): string[] | null {
  const role = (user?.role || '').toLowerCase();
  if (['superadmin', 'superamin', 'owner'].includes(role)) return null;
  return user?.subsidiaryIds ?? [];
}
