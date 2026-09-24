import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { CatalogService } from './catalog.service';
import { CategoryDto, ServiceDto, UpdateCategoryDto, UpdateServiceDto } from './dto/catalog.dto';
import { MTTO_READ } from '../maintenance.permissions';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance/catalog')
@UseGuards(PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @RequirePermission(...MTTO_READ)
  listCategories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @RequirePermission('mttoVehiculos.catalogos')
  createCategory(@Body() dto: CategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch('categories/:id')
  @RequirePermission('mttoVehiculos.catalogos')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(id, dto);
  }

  @Get('services')
  @RequirePermission(...MTTO_READ)
  listServices(
    @Query('categoryId') categoryId?: string,
    @Query('vehicleType') vehicleType?: string,
    @Query('q') q?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalog.listServices({ categoryId, vehicleType, q, includeInactive: includeInactive === 'true' });
  }

  @Post('services')
  @RequirePermission('mttoVehiculos.catalogos')
  createService(@Body() dto: ServiceDto) {
    return this.catalog.createService(dto);
  }

  @Patch('services/:id')
  @RequirePermission('mttoVehiculos.catalogos')
  updateService(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.catalog.updateService(id, dto);
  }

  @Delete('services/:id')
  @RequirePermission('mttoVehiculos.catalogos')
  removeService(@Param('id') id: string) {
    return this.catalog.removeService(id);
  }
}
