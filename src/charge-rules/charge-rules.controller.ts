import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { ChargeRulesService } from './charge-rules.service';
import { UpsertChargeRuleDto } from './dto/charge-rule.dto';

@ApiTags('charge-rules')
@ApiBearerAuth()
@Controller('charge-rules')
export class ChargeRulesController {
  constructor(private readonly service: ChargeRulesService) {}

  /** Lectura: cualquier autenticado (para mostrar en Configuración). */
  @Get()
  getAll() {
    return this.service.getAll();
  }

  /** Vista efectiva (override sobre global) para una sucursal. */
  @Get('effective')
  getEffective(@Query('subsidiaryId') subsidiaryId: string) {
    return this.service.getEffective(subsidiaryId);
  }

  /** Escritura: solo admin. */
  @Put()
  @UseGuards(AdminGuard)
  upsert(@Body() dto: UpsertChargeRuleDto) {
    return this.service.upsert(dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
