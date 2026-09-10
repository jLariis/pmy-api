import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Acceso al Consolidador de Finanzas. Espeja `IncomeAccessGuard` (role-based, con scoping por
 * sucursal) y además ACOTA la escritura: las operaciones que no son GET exigen un rol elevado
 * (no `auxiliar`). Se apoya en `req.user` (poblado por el JwtAuthGuard global).
 */
@Injectable()
export class ConsolidadorAccessGuard implements CanActivate {
  static readonly FINANCE_ROLES = ['admin', 'subadmin', 'superadmin', 'superamin', 'owner', 'auxiliar'];
  static readonly WRITE_ROLES = ['admin', 'subadmin', 'superadmin', 'superamin', 'owner'];
  static readonly GLOBAL_ROLES = ['superadmin', 'superamin', 'owner'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();

    if (!ConsolidadorAccessGuard.FINANCE_ROLES.includes(role)) {
      throw new ForbiddenException('No tienes acceso al consolidador.');
    }
    if (req.method !== 'GET' && !ConsolidadorAccessGuard.WRITE_ROLES.includes(role)) {
      throw new ForbiddenException('No puedes editar en el consolidador.');
    }

    // Scoping por sucursal: los no-elevados solo operan las suyas (main + adicionales).
    const requested = req.params?.subsidiaryId;
    if (requested && !ConsolidadorAccessGuard.GLOBAL_ROLES.includes(role)) {
      const allowed: string[] = req.user?.subsidiaryIds || [];
      if (!allowed.includes(requested)) {
        throw new ForbiddenException('Solo puedes operar las finanzas de tus sucursales asignadas.');
      }
    }
    return true;
  }
}
