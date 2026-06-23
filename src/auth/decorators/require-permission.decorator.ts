import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Exige uno o más permisos (codes del catálogo RBAC) para acceder al endpoint.
 * Por defecto basta con tener UNO de los listados (OR). Se evalúa con el
 * `PermissionsGuard`, que lee `req.user.permissions` (sembrado en el JWT al
 * iniciar sesión) y deja pasar siempre a superadmin.
 *
 * @example
 *   @RequirePermission('usuarios')
 *   @RequirePermission('finanzas', 'reportes')
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
