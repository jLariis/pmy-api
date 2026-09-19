import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../../audit/super-admin.guard';
import { NoAudit } from '../../audit/audit.decorator';
import { Public } from '../../auth/decorators/decorators/public-decorator';
import { ServerPowerService } from './server-power.service';
import { UpdatePowerScheduleDto } from './dto/update-power-schedule.dto';
import { PowerSecretGuard } from './power-secret.guard';

@ApiTags('server')
@ApiBearerAuth()
@Controller('server/power')
export class ServerPowerController {
  constructor(private readonly svc: ServerPowerService) {}

  /** Horario actual + estado — solo superadmin. */
  @Get('schedule')
  @UseGuards(SuperAdminGuard)
  get() {
    return this.svc.get();
  }

  /** Guarda horario/días/destinatarios y lo aplica al SO — solo superadmin. */
  @Put('schedule')
  @UseGuards(SuperAdminGuard)
  update(@Body() dto: UpdatePowerScheduleDto, @Req() req: any) {
    return this.svc.update(dto, req.user?.id);
  }

  /** Suspende el servidor de inmediato — solo superadmin. */
  @Post('suspend-now')
  @UseGuards(SuperAdminGuard)
  suspendNow() {
    return this.svc.suspendNow();
  }

  /** Correo de prueba — solo superadmin. */
  @Post('test-email')
  @UseGuards(SuperAdminGuard)
  async testEmail() {
    await this.svc.sendTestEmail();
    return { ok: true };
  }

  /** Lo llaman los hooks de systemd-sleep en localhost (secreto compartido). */
  @Post('internal/notify')
  @Public()
  @NoAudit()
  @UseGuards(PowerSecretGuard)
  async notify(@Body() body: { event: 'suspend' | 'wake' }) {
    const event = body?.event === 'wake' ? 'wake' : 'suspend';
    await this.svc.notify(event);
    return { ok: true };
  }
}
