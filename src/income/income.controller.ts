import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IncomeService } from './income.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IncomeAccessGuard } from 'src/auth/guards/income-access.guard';

@ApiTags('incomes')
@ApiBearerAuth()
@UseGuards(IncomeAccessGuard) // Roles de finanzas + scoping por sucursal.
@Controller('incomes')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  /** Valida y parsea una fecha; lanza 400 si es inválida (antes pasaba Invalid Date). */
  private parseDateOrThrow(value: string, field: string): Date {
    const d = new Date(value);
    if (!value || isNaN(d.getTime())) {
      throw new BadRequestException(`Fecha inválida en "${field}": ${value}`);
    }
    return d;
  }


  /*@Get('month/:firstDay/:lastDay')
  getIncomeMonthlyAll(
    @Param('firstDay') firstDay: string,
    @Param('lastDay') lastDay: string,
  ) {
    const firstDayOfWeek= new Date(firstDay);
    console.log("🚀 ~ IncomeController ~ firstDayOfWeek:", firstDayOfWeek)
    const lastDayOfWeek = new Date(lastDay);
    return this.incomeService.getMonthlyShipmentReport(firstDayOfWeek,lastDayOfWeek)  
  }

  @Get(':subsidiary/:firstDay/:lastDay')
  getIncomeBySucursal(
    @Param('subsidiary') subsiary: string,
    @Param('firstDay') firstDay: string,
    @Param('lastDay') lastDay: string,
  ) {
    
    console.log("🚀 ~ IncomeController ~ lastDay:", lastDay)
    console.log("🚀 ~ IncomeController ~ firstDay:", firstDay)
    const firstDayOfWeek= new Date(firstDay);
    const lastDayOfWeek = new Date(lastDay);

    console.log("🚀 ~ IncomeController ~ firstDayOfWeek:", firstDayOfWeek)
    console.log("🚀 ~ IncomeController ~ lastDayOfWeek:", lastDayOfWeek)

    
    return this.incomeService.getWeecklyShipmentReport(subsiary,firstDayOfWeek,lastDayOfWeek)  
  }*/

  /**** Sera para lo usuarios que no tengan role admin*/
  /*@Get('monthAndSubsidiary/:subsidiary/:firstDay/:lastDay')
  getIncomeMonthlyBySucursal(
    @Param('subsidiary') subsiary: string,
    @Param('firstDay') firstDay: string,
    @Param('lastDay') lastDay: string,
  ) {
    const firstDayOfWeek= new Date(firstDay);
    const lastDayOfWeek = new Date(lastDay);
    return this.incomeService.getMonthShipmentReportBySucursal(subsiary,firstDayOfWeek,lastDayOfWeek)  
  }*/

  /************ DE AQUI PARA ARRIBA QUITAR USAR LOS DE ABAJO ***********/
  /*** Método que llena la tabla de ingresos dentro de finanzas */
  @Get('bySucursal/:subsidiaryId')
  getIncomeBySucursalAndDates(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    const fDate = this.parseDateOrThrow(fromDate, 'fromDate');
    const tDate = this.parseDateOrThrow(toDate, 'toDate');
    return this.incomeService.getIncome(subsidiaryId, fDate, tDate)
  }

  @Get('finantial/:subsidiaryId/:firstDay/:lastDay')
  getFinantialForDashboard(
    @Param('subsidiaryId') subsiaryId: string,
    @Param('firstDay') firstDay: string,
    @Param('lastDay') lastDay: string
  ){
    const startDay = this.parseDateOrThrow(firstDay, 'firstDay');
    const endDay = this.parseDateOrThrow(lastDay, 'lastDay');
    return this.incomeService.getFinantialDataForDashboard(subsiaryId, startDay, endDay);
  }

}
