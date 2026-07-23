import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Restringe el acceso a SUPERADMIN únicamente (más estricto que `AdminGuard`,
 * que admite admin/subadmin/owner). Se usa para acciones peligrosas como el
 * rollback de operaciones de bodega. Acepta el typo histórico 'superamin'
 * (consistente con `SUPER_ROLES` del frontend). Se apoya en `req.user` ya
 * poblado por el JwtAuthGuard global.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  private static readonly SUPER_ROLES = ['superadmin', 'superamin'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    if (!SuperAdminGuard.SUPER_ROLES.includes(role)) {
      throw new ForbiddenException('Requiere permisos de superadministrador.');
    }
    return true;
  }
}
