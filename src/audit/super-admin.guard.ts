import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Restringe el acceso EXCLUSIVAMENTE a superadmin. Se apoya en `req.user`
 * (ya poblado por el JwtAuthGuard global), por lo que no necesita re-verificar
 * el token ni dependencias adicionales. Acepta la variante histórica 'superamin'.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  private static readonly SUPERADMIN_ROLES = ['superadmin', 'superamin'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    return SuperAdminGuard.SUPERADMIN_ROLES.includes(role);
  }
}
