import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsolidadorStatusService } from './status/consolidador-status.service';

/**
 * Timeline unificado de una guía (el mismo del Consolidador) para pantallas operativas como
 * "Ver salida". Solo lectura y sin el candado de acceso al Consolidador: basta la sesión.
 */
@ApiTags('package-timeline')
@ApiBearerAuth()
@Controller('package-timeline')
export class PackageTimelineController {
  constructor(private readonly status: ConsolidadorStatusService) {}

  /** `?id=&isCharge=1` fija el registro exacto (envío o carga) cuando la guía tiene varios. */
  @Get(':tracking')
  timeline(@Param('tracking') tracking: string, @Query('id') id?: string, @Query('isCharge') isCharge?: string) {
    return this.status.packageTimeline(tracking, id ? { id, isCharge: isCharge === '1' || isCharge === 'true' } : undefined);
  }
}
