import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsolidadorAccessGuard } from '../auth/guards/consolidador-access.guard';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';
import { ConsolidadorQueryDto } from './dto/consolidador-query.dto';
import { EditCostDto } from './dto/edit-cost.dto';
import { SecondAbordDto } from './dto/second-abord.dto';

@ApiTags('consolidador')
@ApiBearerAuth()
@UseGuards(ConsolidadorAccessGuard)
@Controller('consolidador')
export class ConsolidadorController {
  constructor(
    private readonly read: ConsolidadorReadService,
    private readonly income: ConsolidadorIncomeService,
  ) {}

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

  /** Ajuste in-place del costo de un ingreso (bajar/subir costo de carga). */
  @Patch('income/:id/cost')
  editCost(@Param('id') id: string, @Body() dto: EditCostDto, @Req() req: any) {
    return this.income.editCost(id, dto.cost, dto.reason, req.user?.userId);
  }

  /** Quita/pone el 2º a bordo sobre el costo de la carga. */
  @Patch('income/:id/second-abord')
  setSecondAbord(@Param('id') id: string, @Body() dto: SecondAbordDto, @Req() req: any) {
    return this.income.setSecondAbord(id, dto.enabled, dto.reason, req.user?.userId);
  }
}
