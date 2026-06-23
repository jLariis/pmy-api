import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Restringe el acceso a roles ADMINISTRATIVOS (catálogos de administración:
 * choferes, rutas, vehículos, zonas, sucursales). Se apoya en `req.user`
 * (ya poblado por el JwtAuthGuard global), así que no re-verifica el token.
 *
 * Acepta las variantes históricas/typos que existen en datos y código:
 * 'superamin' (typo de superadmin) y 'subadmin'. Deniega 'user', 'auxiliar'
 * y 'bodega'. Pensado para endpoints de MUTACIÓN (POST/PATCH/DELETE); los GET
 * se dejan abiertos a cualquier usuario autenticado porque los catálogos se
 * consumen en flujos operativos (salidas a ruta, desembarques, etc.).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private static readonly ADMIN_ROLES = [
    'admin',
    'superadmin',
    'superamin',
    'subadmin',
    'owner',
  ];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    if (!AdminGuard.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Requiere permisos de administrador.');
    }
    return true;
  }
}
