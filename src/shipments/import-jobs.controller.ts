import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { ImportJobsService } from './import-jobs.service';
import { CreateImportJobDto, PreviewImportDto } from './import-jobs.dto';

/**
 * Importación por *paste* (Pegar FedEx): async por job. Cubre envíos (`master`) y
 * carga/F2/31.5 (`charge`). El wizard NO usa estos endpoints.
 */
@ApiTags('import-jobs')
@ApiBearerAuth()
@Controller('import-jobs')
@UseGuards(PermissionsGuard)
@RequirePermission('operaciones.pegarFedex')
export class ImportJobsController {
  constructor(private readonly service: ImportJobsService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Validar el pegado (read-only): nuevas / reingresos / ya existen / dup' })
  preview(@Body() dto: PreviewImportDto) {
    return this.service.preview(dto);
  }

  @Post()
  @ApiOperation({ summary: 'Crear job de importación desde paste (responde jobId al instante)' })
  create(@Body() dto: CreateImportJobDto, @Req() req?: any) {
    return this.service.create(dto, { userId: req?.user?.userId, name: req?.user?.name });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Estado + contadores de un job (para polling)' })
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get()
  @ApiOperation({ summary: 'Historial de jobs (monitor)' })
  list(@Query('subsidiaryId') subsidiaryId?: string, @Query('kind') kind?: string, @Query('limit') limit?: string) {
    return this.service.list(subsidiaryId, kind, limit ? Number(limit) : 25);
  }

  @Get(':id/failed.xlsx')
  @ApiOperation({ summary: 'Descargar Excel de guías fallidas del job' })
  async failedXlsx(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.service.buildFailedXlsx(id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import-${id}-fallidas.xlsx"`);
    res.end(buf);
  }

  @Post(':id/retry-failed')
  @ApiOperation({ summary: 'Reintentar solo las guías fallidas (crea job hijo)' })
  retry(@Param('id') id: string) {
    return this.service.retryFailed(id);
  }
}
