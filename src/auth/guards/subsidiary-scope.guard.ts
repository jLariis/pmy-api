import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Acota por sucursal: un usuario NO elevado solo puede consultar datos de SU
 * sucursal (el `subsidiaryId` del param debe coincidir con el suyo). Los roles
 * elevados ven todas. A diferencia de IncomeAccessGuard, NO restringe el rol
 * (lo usan endpoints de reportes accesibles a más roles); solo aplica el scoping.
 */
@Injectable()
export class SubsidiaryScopeGuard implements CanActivate {
  private static readonly GLOBAL_ROLES = ['admin', 'subadmin', 'superadmin', 'superamin', 'owner'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    const requested = req.params?.subsidiaryId;

    if (requested && !SubsidiaryScopeGuard.GLOBAL_ROLES.includes(role)) {
      const own = req.user?.subsidiary?.id;
      if (!own || requested !== own) {
        throw new ForbiddenException('Solo puedes consultar datos de tu sucursal.');
      }
    }
    return true;
  }
}
