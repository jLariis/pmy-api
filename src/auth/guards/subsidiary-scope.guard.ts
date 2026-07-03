import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Acota por sucursal: un usuario NO elevado solo puede consultar datos de las
 * sucursales que tiene asignadas (su "main" + las adicionales que le haya dado
 * un superadmin — `req.user.subsidiaryIds`). Solo `superadmin`/`owner` (dueños
 * globales del sistema) ven todas; `admin`/`subadmin` son administradores
 * locales y también quedan acotados. A diferencia de IncomeAccessGuard, NO
 * restringe el rol (lo usan endpoints de reportes accesibles a más roles);
 * solo aplica el scoping.
 */
@Injectable()
export class SubsidiaryScopeGuard implements CanActivate {
  private static readonly GLOBAL_ROLES = ['superadmin', 'superamin', 'owner'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    const requested = req.params?.subsidiaryId;

    if (requested && !SubsidiaryScopeGuard.GLOBAL_ROLES.includes(role)) {
      const allowed: string[] = req.user?.subsidiaryIds || [];
      if (!allowed.includes(requested)) {
        throw new ForbiddenException('Solo puedes consultar datos de tus sucursales asignadas.');
      }
    }
    return true;
  }
}
