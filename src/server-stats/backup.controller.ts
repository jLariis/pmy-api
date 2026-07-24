import { Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BackupService } from './backup.service';
import { BackupSecretGuard } from './backup-secret.guard';
import { SuperAdminGuard } from '../audit/super-admin.guard';
import { NoAudit } from 'src/audit/audit.decorator';
import { Public } from 'src/auth/decorators/decorators/public-decorator';

@ApiTags('server')
@Controller('server/backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Estado de la función de respaldo (¿este proceso puede restaurar en local?).
   * Lo consume la UI para mostrar/activar la tarjeta solo en desarrollo.
   */
  @Get('status')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @NoAudit()
  status() {
    return this.backupService.status();
  }

  /**
   * Dump comprimido de la BD conectada (en prod = producción). Público a nivel
   * de JWT porque el backend local no tiene un token válido de prod: la
   * autorización es el secreto compartido `X-Backup-Secret`.
   */
  @Get('dump')
  @Public()
  @UseGuards(BackupSecretGuard)
  @NoAudit()
  dump(@Res() res: Response) {
    this.backupService.streamDump(res);
  }

  /**
   * Trae el dump de producción y lo restaura en el MySQL local (SOLO-DEV).
   * Transmite el progreso en NDJSON. Solo superadmin.
   */
  @Post('restore-from-prod')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @NoAudit()
  restoreFromProd(@Res() res: Response) {
    return this.backupService.restoreFromProd(res);
  }
}
