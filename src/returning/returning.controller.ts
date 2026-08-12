import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReturningService } from './returning.service';
import { CreateReturningDto } from './dto/create-returning.dto';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';

@ApiTags('returning')
@Controller('returning')
@UseGuards(PermissionsGuard)
@RequirePermission('operaciones.devoluciones')
export class ReturningController {
  constructor(private readonly returningService: ReturningService) {}

  /** Guardado unificado de una salida (lote de devoluciones + recolecciones). */
  @Post()
  create(@Body() dto: CreateReturningDto, @Req() req: any) {
    return this.returningService.create(dto, req.user?.userId);
  }

  /** Historial de salidas de una sucursal (paginado + filtrado por semana en backend). */
  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.returningService.findBySubsidiary(subsidiaryId, { page, limit, from, to, search });
  }

  /** Detalle de una salida (con sus devoluciones y recolecciones). */
  @Get('detail/:id')
  findOneDetail(@Param('id') id: string) {
    return this.returningService.findOneDetail(id);
  }
}
