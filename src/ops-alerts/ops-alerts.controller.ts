import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { LEGACY_ROLE_MAP } from 'src/auth/rbac/permission-catalog';
import { OpsAlertsService } from './ops-alerts.service';
import { OpsAlertSettings, OpsAlertSubsidiary } from '../entities/ops-alert.entity';

/**
 * Seguimiento de consolidados y alertas operativas. Ver: permiso de la bandeja;
 * configurar: solo superadmin.
 */
@ApiTags('ops-alerts')
@ApiBearerAuth()
@Controller('ops-alerts')
@UseGuards(PermissionsGuard)
@RequirePermission('correo.bandeja')
export class OpsAlertsController {
  constructor(private readonly service: OpsAlertsService) {}

  private isSuper(req: any) {
    return LEGACY_ROLE_MAP[String(req?.user?.role ?? '').toLowerCase()] === 'superadmin';
  }
  private scope(req: any): string[] | null {
    return this.isSuper(req) ? null : ((req?.user?.subsidiaryIds as string[] | undefined) ?? []);
  }
  private requireSuper(req: any) {
    if (!this.isSuper(req)) throw new ForbiddenException('Solo el superadministrador puede cambiar esta configuración');
  }

  @Get('tracking')
  @ApiOperation({ summary: 'Recorrido de los consolidados recibidos en un rango (YYYY-MM-DD, hora de Hermosillo)' })
  tracking(@Query() q: { from?: string; to?: string; subsidiaryId?: string }, @Req() req: any) {
    const day = (s: string | undefined, fallback: Date) => (s ? new Date(`${s}T07:00:00.000Z`) : fallback);
    const today = new Date(new Date(Date.now() - 7 * 3_600_000).toISOString().slice(0, 10) + 'T07:00:00.000Z');
    const from = day(q.from, today);
    const to = new Date(day(q.to, today).getTime() + 86_400_000);
    return this.service.trackingForRange(from, to, this.scope(req), q.subsidiaryId);
  }

  @Get('tracking/message/:id')
  trackingForMessage(@Param('id') id: string) {
    return this.service.trackingForMessage(id);
  }

  @Get('open')
  open(@Req() req: any) {
    return this.service.openAlerts(this.scope(req));
  }

  @Get('settings')
  settings() {
    return this.service.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() body: Partial<OpsAlertSettings>, @Req() req: any) {
    this.requireSuper(req);
    return this.service.updateSettings(body ?? {}, req?.user?.userId ?? null);
  }

  @Get('subsidiaries')
  subsidiaries(@Req() req: any) {
    this.requireSuper(req);
    return this.service.listSubsidiaryConfig();
  }

  @Put('subsidiaries/:id')
  updateSubsidiary(@Param('id') id: string, @Body() body: Partial<OpsAlertSubsidiary>, @Req() req: any) {
    this.requireSuper(req);
    return this.service.updateSubsidiaryConfig(id, body ?? {});
  }

  @Get('whatsapp-groups')
  groups(@Req() req: any) {
    this.requireSuper(req);
    return this.service.whatsappGroups();
  }

  @Post('evaluate')
  @ApiOperation({ summary: 'Revisar ahora (aunque las alertas estén apagadas no envía nada si no están activas)' })
  evaluate(@Req() req: any) {
    this.requireSuper(req);
    return this.service.evaluate(new Date(), false);
  }
}
