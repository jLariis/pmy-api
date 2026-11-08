import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { RouteZipCoverageStatus } from 'src/entities/route-zip-coverage.entity';
import { RouteCoverageService } from './route-coverage.service';

/** CPs que atiende cada ruta (base de las sugerencias de salida). Editar = administradores. */
@ApiTags('route-zip-coverage')
@ApiBearerAuth()
@Controller('route-zip-coverage')
export class RouteCoverageController {
  constructor(private readonly coverage: RouteCoverageService) {}

  @Get()
  @ApiOperation({ summary: 'Rutas de la sucursal con sus CPs y los CPs sin ruta' })
  summary(@Query('subsidiaryId') subsidiaryId: string) {
    return this.coverage.summary(subsidiaryId);
  }

  @Post('rebuild')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Recalcula con el historial de salidas (6 meses)' })
  rebuild(@Body() body: { subsidiaryId?: string }) {
    return this.coverage.rebuildFromHistory(body?.subsidiaryId || undefined);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Agrega un CP a una ruta (queda confirmado)' })
  add(@Body() body: { zip: string; routeId: string; city?: string }) {
    return this.coverage.addManual(body);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Confirma, excluye o regresa a sugerido un CP de una ruta' })
  setStatus(@Param('id') id: string, @Body() body: { status: RouteZipCoverageStatus }) {
    return this.coverage.setStatus(id, body?.status);
  }
}
