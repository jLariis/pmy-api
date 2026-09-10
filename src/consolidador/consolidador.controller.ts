import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsolidadorAccessGuard } from '../auth/guards/consolidador-access.guard';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorQueryDto } from './dto/consolidador-query.dto';

@ApiTags('consolidador')
@ApiBearerAuth()
@UseGuards(ConsolidadorAccessGuard)
@Controller('consolidador')
export class ConsolidadorController {
  constructor(private readonly read: ConsolidadorReadService) {}

  /** Filas de income de la semana (todos los sourceType) + totales por bucket. */
  @Get(':subsidiaryId/:fromDate/:toDate')
  getWeek(
    @Param('subsidiaryId') subsidiaryId: string,
    @Param('fromDate') fromDate: string,
    @Param('toDate') toDate: string,
    @Query() q: ConsolidadorQueryDto,
  ) {
    // Los límites de la semana llegan ya calculados desde el FE (lun–dom); se respetan tal cual.
    return this.read.getWeek(subsidiaryId, new Date(fromDate), new Date(toDate), q);
  }
}
