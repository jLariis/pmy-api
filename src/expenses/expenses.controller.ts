import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Expense } from 'src/entities';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  create(@Body() createExpenseDto: Expense) {
    return this.expensesService.create(createExpenseDto);
  }

  @Get(':subsidiaryId')
  getIExpenesesBySucursal(@Param('subsidiaryId') subsidiaryId: string) {
    console.log("🚀 ~ ExpensesController ~ getIExpenesesBySucursal ~ subsidiaryId:", subsidiaryId)
    return this.expensesService.findBySubsidiary(subsidiaryId)  
  }

  @Get()
  findAll() {
    return this.expensesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateExpenseDto: UpdateExpenseDto) {
    return this.expensesService.update(id, updateExpenseDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.expensesService.remove(id);
  }

  @Get('/findBySubsidiaryAndDates')
  getExpensesBySucursalAndDates(
    @Query('subsidiaryId') subsidiaryId: string,
    @Query('firstDay') firstDay: string,
    @Query('lastDay') lastDay: string
  ) {
    const firstDayOfMonth = new Date(firstDay);
    const lastDayOfMonth = new Date(lastDay);
    return this.expensesService.findBySubsidiaryAndDates(subsidiaryId, firstDayOfMonth, lastDayOfMonth)  
  }
}
