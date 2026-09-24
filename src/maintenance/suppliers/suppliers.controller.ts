import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { SuppliersService } from './suppliers.service';
import { SupplierDto } from './dto/supplier.dto';
import { MTTO, MTTO_READ } from '../maintenance.permissions';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance/suppliers')
@UseGuards(PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission(...MTTO_READ)
  list(@Query('q') q?: string, @Query('includeInactive') includeInactive?: string) {
    return this.suppliers.list(q, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermission(...MTTO_READ)
  findOne(@Param('id') id: string) {
    return this.suppliers.findOne(id);
  }

  @Post()
  @RequirePermission(MTTO.catalogos)
  create(@Body() dto: SupplierDto) {
    return this.suppliers.create(dto);
  }

  @Patch(':id')
  @RequirePermission(MTTO.catalogos)
  update(@Param('id') id: string, @Body() dto: SupplierDto) {
    return this.suppliers.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission(MTTO.catalogos)
  remove(@Param('id') id: string) {
    return this.suppliers.remove(id);
  }
}
