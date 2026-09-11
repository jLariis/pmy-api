import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsolidadorAccessGuard } from '../auth/guards/consolidador-access.guard';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';
import { ConsolidadorStatusService } from './status/consolidador-status.service';
import { ConsolidadorAuditService } from './audit/consolidador-audit.service';
import { ConsolidadorQueryDto } from './dto/consolidador-query.dto';
import { EditCostDto } from './dto/edit-cost.dto';
import { EditDateDto } from './dto/edit-date.dto';
import { SecondAbordDto } from './dto/second-abord.dto';
import { CreateManualIncomeDto } from './dto/create-manual-income.dto';
import { FixStatusDto } from './dto/fix-status.dto';
import { SearchBatchDto } from './dto/search-batch.dto';
import { DeleteIncomeDto } from './dto/delete-income.dto';
import { RepairIncomeDto } from './dto/repair-income.dto';
import { ReassignSubsidiaryDto } from './dto/reassign-subsidiary.dto';

@ApiTags('consolidador')
@ApiBearerAuth()
@UseGuards(ConsolidadorAccessGuard)
@Controller('consolidador')
export class ConsolidadorController {
  constructor(
    private readonly read: ConsolidadorReadService,
    private readonly income: ConsolidadorIncomeService,
    private readonly status: ConsolidadorStatusService,
    private readonly audit: ConsolidadorAuditService,
  ) {}

  /** Ingresos con anomalías de la semana (panel de revisión). */
  @Get(':subsidiaryId/:fromDate/:toDate/anomalies')
  weekAnomalies(
    @Param('subsidiaryId') subsidiaryId: string,
    @Param('fromDate') fromDate: string,
    @Param('toDate') toDate: string,
  ) {
    const from = new Date(`${fromDate}T00:00:00.000`);
    const to = new Date(`${toDate}T23:59:59.999`);
    return this.read.getWeekAnomalies(subsidiaryId, from, to);
  }

  /** Historial de cambios de un ingreso (más reciente primero). */
  @Get('income/:id/history')
  history(@Param('id') id: string) {
    return this.audit.history(id);
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

  /** Cambia la fecha del ingreso (fecha mal registrada). */
  @Patch('income/:id/date')
  editDate(@Param('id') id: string, @Body() dto: EditDateDto, @Req() req: any) {
    return this.income.editDate(id, dto.date, dto.reason, req.user?.userId);
  }

  /** Reasigna el ingreso a otra sucursal (ingreso mal asignado). */
  @Patch('income/:id/subsidiary')
  reassignSubsidiary(@Param('id') id: string, @Body() dto: ReassignSubsidiaryDto, @Req() req: any) {
    return this.income.reassignSubsidiary(id, dto.subsidiaryId, dto.reason, req.user?.userId);
  }

  /** Alta manual de ingreso (recolección / POD / DEX / manual). */
  @Post('income')
  createManual(@Body() dto: CreateManualIncomeDto, @Req() req: any) {
    return this.income.createManual(dto, req.user?.userId);
  }

  /** Elimina (soft-delete) un ingreso: deja de contar en los reportes. */
  @Delete('income/:id')
  deleteIncome(@Param('id') id: string, @Body() dto: DeleteIncomeDto, @Req() req: any) {
    return this.income.deleteIncome(id, dto.reason, req.user?.userId);
  }

  /** Busca un paquete: estatus interno vs FedEx canónico + income ligado. */
  @Get('package/:tracking')
  searchPackage(@Param('tracking') tracking: string) {
    return this.status.search(tracking);
  }

  /** Timeline unificado del paquete (recibido, consolidado, salida a ruta, FedEx, ingreso). */
  @Get('package/:tracking/timeline')
  packageTimeline(@Param('tracking') tracking: string) {
    return this.status.packageTimeline(tracking);
  }

  /** Búsqueda por lote (hasta 30 guías): interno vs FedEx + income ligado por guía. */
  @Post('package/batch')
  searchBatch(@Body() dto: SearchBatchDto) {
    return this.status.searchBatch(dto.trackings);
  }

  /** Corrige el estatus del shipment (verificado contra FedEx) y ajusta el income ligado. */
  @Patch('package/:shipmentId/status')
  fixStatus(@Param('shipmentId') id: string, @Body() dto: FixStatusDto, @Req() req: any) {
    return this.status.fixStatus(id, dto.newStatus, dto.reason, req.user?.userId);
  }

  /** Repara el ingreso del paquete: crea el ingreso si falta y su estatus es cobrable. */
  @Patch('package/:shipmentId/repair-income')
  repairIncome(@Param('shipmentId') id: string, @Body() dto: RepairIncomeDto, @Req() req: any) {
    return this.status.repairIncome(id, dto.reason, req.user?.userId);
  }

  /**
   * Filas de income de la semana (todos los sourceType) + totales por bucket.
   * IMPORTANTE: va al FINAL — su patrón `:subsidiaryId/:fromDate/:toDate` (3 segmentos dinámicos)
   * ensombrecería rutas más específicas de 3 segmentos como `income/:id/history` si se declarara antes.
   */
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
}
