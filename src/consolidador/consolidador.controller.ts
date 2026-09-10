import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsolidadorAccessGuard } from '../auth/guards/consolidador-access.guard';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';
import { ConsolidadorStatusService } from './status/consolidador-status.service';
import { ConsolidadorQueryDto } from './dto/consolidador-query.dto';
import { EditCostDto } from './dto/edit-cost.dto';
import { SecondAbordDto } from './dto/second-abord.dto';
import { CreateManualIncomeDto } from './dto/create-manual-income.dto';
import { FixStatusDto } from './dto/fix-status.dto';

@ApiTags('consolidador')
@ApiBearerAuth()
@UseGuards(ConsolidadorAccessGuard)
@Controller('consolidador')
export class ConsolidadorController {
  constructor(
    private readonly read: ConsolidadorReadService,
    private readonly income: ConsolidadorIncomeService,
    private readonly status: ConsolidadorStatusService,
  ) {}

  /** Filas de income de la semana (todos los sourceType) + totales por bucket. */
  @Get(':subsidiaryId/:fromDate/:toDate')
  getWeek(
    @Param('subsidiaryId') subsidiaryId: string,
    @Param('fromDate') fromDate: string,
    @Param('toDate') toDate: string,
    @Query() q: ConsolidadorQueryDto,
  ) {
    // Los límites llegan como YYYY-MM-DD (lun–dom) desde el FE. `new Date('YYYY-MM-DD')` es
    // medianoche UTC, lo que dejaría fuera casi todo el domingo; expandimos a inicio/fin de día.
    const from = new Date(`${fromDate}T00:00:00.000`);
    const to = new Date(`${toDate}T23:59:59.999`);
    return this.read.getWeek(subsidiaryId, from, to, q);
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

  /** Alta manual de ingreso (recolección / POD / DEX / manual). */
  @Post('income')
  createManual(@Body() dto: CreateManualIncomeDto, @Req() req: any) {
    return this.income.createManual(dto, req.user?.userId);
  }

  /** Busca un paquete: estatus interno vs FedEx canónico + income ligado. */
  @Get('package/:tracking')
  searchPackage(@Param('tracking') tracking: string) {
    return this.status.search(tracking);
  }

  /** Corrige el estatus del shipment (verificado contra FedEx) y ajusta el income ligado. */
  @Patch('package/:shipmentId/status')
  fixStatus(@Param('shipmentId') id: string, @Body() dto: FixStatusDto, @Req() req: any) {
    return this.status.fixStatus(id, dto.newStatus, dto.reason, req.user?.userId);
  }
}
