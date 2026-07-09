import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  CreateExpenseCategoryDto, UpdateExpenseCategoryDto,
  CreateExpenseGroupDto, UpdateExpenseGroupDto,
} from './dto/expense-category.dto';

@ApiTags('expense-categories')
@ApiBearerAuth()
@Controller('expense-categories')
@UseGuards(JwtAuthGuard)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  getGrouped(@Query('includeInactive') includeInactive?: string) {
    return this.service.getGrouped(includeInactive === 'true');
  }

  @Post()
  createCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Patch(':id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete(':id')
  removeCategory(@Param('id') id: string) {
    return this.service.removeCategory(id);
  }

  @Get('groups/all')
  listGroups() {
    return this.service.listGroups();
  }

  @Post('groups')
  createGroup(@Body() dto: CreateExpenseGroupDto) {
    return this.service.createGroup(dto);
  }

  @Patch('groups/:id')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateExpenseGroupDto) {
    return this.service.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id') id: string) {
    return this.service.removeGroup(id);
  }
}
