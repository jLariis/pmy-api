import { Controller, Get, Param, Query } from '@nestjs/common';
import { IncomeService } from './income.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('incomes')
@ApiBearerAuth()
@Controller('incomes')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}


  @Get('month/:firstDay/:lastDay')
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
    const firstDayOfWeek= new Date(firstDay);
    const lastDayOfWeek = new Date(lastDay);
    return this.incomeService.getWeecklyShipmentReport(subsiary,firstDayOfWeek,lastDayOfWeek)  
  }

  /**** Sera para lo usuarios que no tengan role admin*/
  @Get('monthAndSubsidiary/:subsidiary/:firstDay/:lastDay')
  getIncomeMonthlyBySucursal(
    @Param('subsidiary') subsiary: string,
    @Param('firstDay') firstDay: string,
    @Param('lastDay') lastDay: string,
  ) {
    const firstDayOfWeek= new Date(firstDay);
    const lastDayOfWeek = new Date(lastDay);
    return this.incomeService.getMonthShipmentReportBySucursal(subsiary,firstDayOfWeek,lastDayOfWeek)  
  }

  @Get('finantial/:subsidiary/:firstDay/:lastDay')
  getFinantialResume(
    @Param('subsidiary') subsiary: string, 
    @Param('firstDay') firstDay: string, 
    @Param('lastDay') lastDay: string) {
    const firstDayOfMonth = new Date(firstDay);
    const lastDayOfMonth = new Date(lastDay);

    return this.incomeService.getMonthShipmentReportBySucursal(subsiary, firstDayOfMonth, lastDayOfMonth);  
  }

  /************ DE AQUI PARA ARRIBA QUITAR USAR LOS DE ABAJO ***********/


  @Get('finantial/:subsidiaryId')
  getFinantialForDashboard(@Param('subsidiaryId') subsiaryId: string){
    return this.incomeService.getFinantialDataForDashboard(subsiaryId);
  }

  @Get('bySucursal/:subsidiaryId')
  getIncomeBySucursalAndDates(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {

    const fDate = new Date(fromDate);
    const tDate = new Date(toDate);

    return this.incomeService.getIncome(subsidiaryId, fDate, tDate)
  }

}
