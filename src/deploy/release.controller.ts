import { Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NoAudit } from '../audit/audit.decorator';
import { Public } from '../auth/decorators/decorators/public-decorator';
import { ReleaseService } from './release.service';

/** El JwtStrategy pone `userId` (no `id`) en req.user. */
export function sessionUserId(req: any): string {
  const id = req?.user?.userId ?? req?.user?.id;
  if (!id) throw new UnauthorizedException('Sesión inválida');
  return String(id);
}

/** Versión del sistema y aviso de novedades (cualquier usuario autenticado). */
@ApiTags('system')
@ApiBearerAuth()
@Controller('system/release')
export class ReleaseController {
  constructor(private readonly svc: ReleaseService) {}

  /** Pública: también la usa el despliegue para confirmar que la API volvió. */
  @Get('current')
  @Public()
  @NoAudit()
  current() {
    return this.svc.current();
  }

  @Get('unseen')
  @NoAudit()
  unseen(@Req() req: any) {
    return this.svc.unseen(sessionUserId(req), req.user?.role);
  }

  @Post('seen')
  @NoAudit()
  seen(@Req() req: any) {
    return this.svc.markSeen(sessionUserId(req));
  }
}
