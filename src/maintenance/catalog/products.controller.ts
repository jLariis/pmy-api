import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { ProductKind } from 'src/entities/product-category.entity';
import { MTTO } from '../maintenance.permissions';
import { ProductsService } from './products.service';
import { ProductCategoryDto, ProductDto, UnitDto } from './dto/products.dto';
import { ServiceTemplatesService } from './service-templates.service';
import { ServiceTemplateDto } from './dto/service-templates.dto';

/**
 * Catálogos de Compras. Lectura: cualquier usuario autenticado (todos levantan solicitudes y eligen
 * productos). Escritura: permiso de catálogos (admin, superadmin, Gerardo).
 */
@ApiTags('compras')
@ApiBearerAuth()
@Controller('maintenance/catalog')
@UseGuards(PermissionsGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly services: ServiceTemplatesService,
  ) {}

  @Get('units')
  listUnits() {
    return this.products.listUnits();
  }

  @Post('units')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  createUnit(@Body() dto: UnitDto) {
    return this.products.saveUnit(dto);
  }

  @Patch('units/:id')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  updateUnit(@Param('id') id: string, @Body() dto: UnitDto) {
    return this.products.saveUnit(dto, id);
  }

  @Get('product-categories')
  listCategories(@Query('kind') kind?: ProductKind) {
    return this.products.listCategories(kind);
  }

  @Post('product-categories')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  createCategory(@Body() dto: ProductCategoryDto) {
    return this.products.saveCategory(dto);
  }

  @Patch('product-categories/:id')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  updateCategory(@Param('id') id: string, @Body() dto: ProductCategoryDto) {
    return this.products.saveCategory(dto, id);
  }

  @Get('products')
  list(
    @Query('q') q?: string,
    @Query('kind') kind?: ProductKind,
    @Query('categoryId') categoryId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.products.list({ q, kind, categoryId, includeInactive: includeInactive === 'true' });
  }

  @Get('products/:id')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  @Post('products')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  create(@Body() dto: ProductDto) {
    return this.products.save(dto);
  }

  @Patch('products/:id')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  update(@Param('id') id: string, @Body() dto: ProductDto) {
    return this.products.save(dto, id);
  }

  @Delete('products/:id')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }

  // ---------------- Servicios predefinidos (Mantenimiento → Servicios) ----------------

  @Get('service-templates')
  listServices(@Query('includeInactive') includeInactive?: string) {
    return this.services.list(includeInactive === 'true');
  }

  @Get('service-templates/:id')
  findService(@Param('id') id: string) {
    return this.services.findOne(id);
  }

  @Post('service-templates')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  createService(@Body() dto: ServiceTemplateDto) {
    return this.services.save(dto);
  }

  @Patch('service-templates/:id')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  updateService(@Param('id') id: string, @Body() dto: ServiceTemplateDto) {
    return this.services.save(dto, id);
  }

  @Delete('service-templates/:id')
  @RequirePermission(MTTO.catalogos, MTTO.revisar)
  removeService(@Param('id') id: string) {
    return this.services.remove(id);
  }
}
