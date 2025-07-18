import { Controller, Get, Param, Query } from '@nestjs/common';
import { IncomeService } from './income.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('incomes')
@ApiBearerAuth()
@Controller('incomes')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}


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

    const fDate = new Date(fromDate);
    const tDate = new Date(toDate);
        
    console.log("Working!!!")
    return this.incomeService.getIncome(subsidiaryId, fDate, tDate)
  }

  @Get('finantial/:subsidiaryId/:firstDay/:lastDay')
  getFinantialForDashboard(
    @Param('subsidiaryId') subsiaryId: string,
    @Param('firstDay') firstDay: string, 
    @Param('lastDay') lastDay: string
  ){
    const startDay= new Date(firstDay);
    const endDay = new Date(lastDay);
    return this.incomeService.getFinantialDataForDashboard(subsiaryId, startDay, endDay);
  }

}
