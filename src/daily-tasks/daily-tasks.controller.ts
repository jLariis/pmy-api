import { BadRequestException, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { LEGACY_ROLE_MAP } from 'src/auth/rbac/permission-catalog';
import { DailyTasksService } from './daily-tasks.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Tareas del día: solo lectura (el sistema detecta lo hecho; nadie marca pasos a mano). */
@ApiTags('daily-tasks')
@ApiBearerAuth()
@Controller('daily-tasks')
@UseGuards(PermissionsGuard)
@RequirePermission('operaciones.tareas')
export class DailyTasksController {
  constructor(private readonly service: DailyTasksService) {}

  private allow(req: any, subsidiaryId: string) {
    const u = req?.user ?? {};
    if (LEGACY_ROLE_MAP[String(u.role ?? '').toLowerCase()] === 'superadmin') return;
    const ids: string[] = [...(u.subsidiaryIds ?? []), u.subsidiary?.id, u.subsidiaryId].filter(Boolean);
    if (!subsidiaryId || !ids.includes(subsidiaryId)) throw new ForbiddenException('No tienes acceso a esa sucursal');
  }

  private day$(day: string) {
    if (!DAY.test(String(day ?? ''))) throw new BadRequestException('Fecha no válida (usa AAAA-MM-DD)');
    return day;
  }

  @Get('week')
  @ApiOperation({ summary: 'Avance de cada día de la semana (lunes a domingo)' })
  async week(@Req() req: any, @Query('subsidiaryId') subsidiaryId: string, @Query('weekStart') weekStart: string) {
    this.allow(req, subsidiaryId);
    return this.service.week(subsidiaryId, this.day$(weekStart));
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen de hoy para el ícono de la barra superior (atrasados, pendientes, posibles LD)' })
  async summary(@Req() req: any, @Query('subsidiaryId') subsidiaryId: string) {
    this.allow(req, subsidiaryId);
    return this.service.summary(subsidiaryId);
  }

  @Get('day')
  @ApiOperation({ summary: 'Tareas de la sucursal y de cada consolidado en un día' })
  async day(@Req() req: any, @Query('subsidiaryId') subsidiaryId: string, @Query('day') day: string) {
    this.allow(req, subsidiaryId);
    return this.service.day(subsidiaryId, this.day$(day));
  }

  @Get('detail/:refType/:refId')
  @ApiOperation({ summary: 'Paquetes de un consolidado: entregados, DEX, devueltos, en bodega y posibles LD' })
  async detail(@Req() req: any, @Param('refType') refType: string, @Param('refId') refId: string) {
    if (refType !== 'consolidated' && refType !== 'charge') throw new BadRequestException('Tipo de consolidado no válido');
    this.allow(req, (await this.service.subsidiaryOfRef(refType, refId)) ?? '');
    return this.service.packageDetail(refType, refId);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Vuelve a revisar el día (no marca nada)' })
  async refresh(@Req() req: any, @Query('subsidiaryId') subsidiaryId: string, @Query('day') day: string) {
    this.allow(req, subsidiaryId);
    await this.service.refreshDay(subsidiaryId, this.day$(day));
    return this.service.day(subsidiaryId, day);
  }
}
