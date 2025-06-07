import { Controller, Get, Param } from '@nestjs/common';
import { IncomeService } from './income.service';

@Controller('incomes')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  @Get('/:subsidiary')
  getIncomeBySucursal(@Param('subsidiary') subsiary: string) {
    return this.incomeService.getDailyShipmentReport(subsiary)  
  }

}
