import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  UploadedFiles,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { SubsidiaryScopeGuard } from 'src/auth/guards/subsidiary-scope.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { SuperAdminGuard } from 'src/auth/guards/super-admin.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { ValidateOneRequestDto } from './dto/validate-one.dto';
import { NoAudit } from 'src/audit/audit.decorator';
import { assertSubsidiaryAccess, canAccessSubsidiary } from './unloading-access.util';

/** Permiso del módulo (catálogo RBAC). */
const DESEMBARQUES = 'operaciones.desembarques';
/** Tope por archivo adjunto del correo (PDF / Excel del desembarque). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Seguridad (2026-11-18): todas las rutas que reciben una sucursal la acotan a las del usuario
 * (por URL con SubsidiaryScopeGuard, o por cuerpo con assertSubsidiaryAccess). Las acciones
 * (crear, validar, subir) además piden el permiso de Desembarques. Antes cualquier usuario con
 * sesión podía crear/consultar desembarques de cualquier sucursal.
 */
@ApiTags('unloadings')
@ApiBearerAuth()
@Controller('unloadings')
export class UnloadingController {
  constructor(private readonly unloadingService: UnloadingService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(DESEMBARQUES)
  create(
    // Solo los campos declarados en el DTO (lo demás se descarta).
    @Body(new ValidationPipe({ whitelist: true, transform: true })) createUnloadingDto: CreateUnloadingDto,
    @Req() req: any,
  ) {
    assertSubsidiaryAccess(req.user, createUnloadingDto.subsidiary?.id);
    return this.unloadingService.create(createUnloadingDto, req.user?.userId);
  }

  /** Reporte "Desembarques" (estilo Visibilidad 67, todos los estatus) por sucursal y rango. */
  @Get('visibility-report/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  getUnloadingVisibilityReport(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const f = from ? new Date(from) : new Date();
    const t = to ? new Date(to) : new Date();
    if (isNaN(f.getTime()) || isNaN(t.getTime())) {
      throw new BadRequestException('Fechas inválidas (from/to).');
    }
    return this.unloadingService.getUnloadingVisibilityReport(subsidiaryId, f, t);
  }

  /**
   * Genera y MANDA por correo el reporte de desembarques. Solo superadmin: cualquiera con sesión
   * podía disparar el correo. El envío diario lo hace el cron llamando al servicio directo.
   */
  @Get('report')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Generar y enviar reporte de desembarques (solo superadmin)' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async getReport(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const toUtcDay = (raw: string, label: string) => {
      const d = new Date(raw);
      if (isNaN(d.getTime())) throw new BadRequestException(`Formato de fecha ${label} inválido`);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    };
    const startDateObj = startDate ? toUtcDay(startDate, 'inicial') : undefined;
    const endDateObj = endDate ? toUtcDay(endDate, 'final') : undefined;
    return this.unloadingService.sendUnloadingReport(startDateObj, endDateObj);
  }

  @Get('subsidiary/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  findBySubsidiary(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.unloadingService.findAllBySubsidiary(subsidiaryId, { page, limit, from, to, search });
  }

  /** Detalle con paquetes. De otra sucursal responde "no encontrado" (no confirma que existe). */
  @Get('detail/:id')
  async findOneWithPackages(@Param('id') id: string, @Req() req: any) {
    const unloading = await this.unloadingService.findOneWithPackages(id);
    if (!unloading || !canAccessSubsidiary(req.user, unloading.subsidiary?.id)) {
      throw new NotFoundException('Desembarque no encontrado.');
    }
    return unloading;
  }

  /** Todos los desembarques de todas las sucursales: solo superadmin. */
  @Get()
  @UseGuards(SuperAdminGuard)
  findAll() {
    return this.unloadingService.findAll();
  }

  @NoAudit() // Validación por escaneo: muy frecuente, no auditable.
  @Post('validate-one')
  @UseGuards(PermissionsGuard)
  @RequirePermission(DESEMBARQUES)
  validateOne(@Body() body: ValidateOneRequestDto, @Req() req: any) {
    assertSubsidiaryAccess(req.user, body.subsidiaryId);
    return this.unloadingService.validateOne(body.trackingNumber, body.subsidiaryId);
  }

  /**
   * Adjuntos del correo del desembarque (PDF + Excel). Solo de un desembarque de las sucursales
   * del usuario; máximo 2 archivos de 10 MB y se revisa el contenido real. Se puede volver a
   * mandar (reenvío); los destinatarios siempre salen de la base, no del cliente.
   */
  @Post('upload')
  @UseGuards(PermissionsGuard)
  @RequirePermission(DESEMBARQUES)
  @UseInterceptors(FilesInterceptor('files', 2, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 2 } }))
  @ApiOperation({ summary: 'Subir PDF y Excel del desembarque y enviarlos por correo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        unloadingId: { type: 'string' },
      },
    },
  })
  async sendEmail(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('unloadingId') unloadingId: string,
    @Req() req: any,
  ) {
    if (!unloadingId) throw new BadRequestException('Falta el desembarque.');
    return this.unloadingService.sendByEmailSecure(files ?? [], unloadingId, req.user);
  }

  @Get('consolidateds/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  getConsolidatedForStartUnloading(@Param('subsidiaryId') subsidiaryId: string) {
    return this.unloadingService.getConsolidateToStartUnloading(subsidiaryId);
  }

  @Get('session-init/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  getUnloadingSessionInit(@Param('subsidiaryId') subsidiaryId: string) {
    return this.unloadingService.getUnloadingSessionInit(subsidiaryId);
  }

  /** Búsqueda directa de un consolidado por número (a BD) para desembarcarlo aunque
   *  no aparezca en la lista del día. Devuelve el formato de session-init. */
  @Get('consolidated-by-cons-number/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  getUnloadingConsolidatedByConsNumber(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('consNumber') consNumber: string,
  ) {
    if (!consNumber || !consNumber.trim()) {
      throw new BadRequestException('El número de consolidado (consNumber) es requerido.');
    }
    return this.unloadingService.getUnloadingConsolidatedByConsNumber(subsidiaryId, consNumber);
  }
}
