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

  /** Llena la tabla de ingresos dentro de finanzas. */
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
