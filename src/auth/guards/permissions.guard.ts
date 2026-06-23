import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

/**
 * Autoriza por PERMISO efectivo (no por rol). Lee los permisos del usuario desde
 * `req.user.permissions` (poblados en el JWT por AuthService.login → RbacService),
 * así que no consulta la BD en cada request.
 *
 * Reglas:
 * - superadmin (y el typo histórico 'superamin') SIEMPRE pasa.
 * - Si el endpoint no declara @RequirePermission, no restringe (pasa).
 * - Basta tener UNO de los permisos requeridos (OR).
 *
 * Pensado para usarse junto al JwtAuthGuard global (que ya pobló req.user).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private static readonly SUPER_ROLES = ['superadmin', 'superamin'];

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;
    if (context.getType() !== 'http') return false;

    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    if (PermissionsGuard.SUPER_ROLES.includes(role)) return true;

    const granted: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const ok = required.some((code) => granted.includes(code));
    if (!ok) {
      throw new ForbiddenException('No cuentas con permisos para esta acción.');
    }
    return true;
  }
}
