import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { CatalogService } from './catalog.service';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/catalog.dto';

/**
 * Catálogo de enums. LECTURA abierta a cualquier autenticado (la consumen los
 * dropdowns de toda la app). MUTACIONES solo superadmin (los valores son contratos
 * del sistema; el borrado está blindado en el service).
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ----- Lectura (autenticado) -----
  @Get()
  getAll() {
    return this.catalog.getAll();
  }

  /** Opciones ACTIVAS de un tipo, para dropdowns. */
  @Get('options/:type')
  getOptions(@Param('type') type: string) {
    return this.catalog.getOptions(type);
  }

  @Get(':type')
  getByType(@Param('type') type: string) {
    return this.catalog.getByType(type);
  }

  @Get(':id/usage')
  usage(@Param('id') id: string) {
    return this.catalog.usage(id);
  }

  // ----- Mutaciones (solo superadmin) -----
  @Post()
  @UseGuards(SuperAdminGuard)
  create(@Body() dto: CreateCatalogItemDto) {
    return this.catalog.create(dto);
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateCatalogItemDto) {
    return this.catalog.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  remove(@Param('id') id: string) {
    return this.catalog.remove(id);
  }
}
