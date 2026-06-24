import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Acceso a Finanzas/Ingresos: (1) restringe a roles con permiso financiero y
 * (2) ACOTA por sucursal — un usuario no-elevado solo puede consultar las
 * finanzas de SU sucursal. Antes cualquier autenticado podía leer las finanzas
 * de cualquier sucursal pasando el `subsidiaryId` en la URL.
 *
 * Se apoya en `req.user` (poblado por el JwtAuthGuard global) y en el
 * `subsidiaryId` de los params. Es role-based a propósito (no usa el
 * PermissionsGuard de RBAC) para no bloquear sesiones cuyo JWT aún no trae
 * `permissions[]`; el set de roles refleja `allowed-page-roles` de finanzas.
 */
@Injectable()
export class IncomeAccessGuard implements CanActivate {
  /** Roles con acceso a finanzas (= allowed-page-roles de finanzas). */
  private static readonly FINANCE_ROLES = ['admin', 'subadmin', 'superadmin', 'superamin', 'owner', 'auxiliar'];
  /** Roles que pueden ver TODAS las sucursales (no se acotan). */
  private static readonly GLOBAL_ROLES = ['admin', 'subadmin', 'superadmin', 'superamin', 'owner'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();

    if (!IncomeAccessGuard.FINANCE_ROLES.includes(role)) {
      throw new ForbiddenException('No tienes acceso al módulo de finanzas.');
    }

    // Scoping por sucursal: los no-elevados solo ven la suya.
    const requested = req.params?.subsidiaryId;
    if (requested && !IncomeAccessGuard.GLOBAL_ROLES.includes(role)) {
      const own = req.user?.subsidiary?.id;
      if (!own || requested !== own) {
        throw new ForbiddenException('Solo puedes consultar las finanzas de tu sucursal.');
      }
    }

    return true;
  }
}
