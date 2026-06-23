import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { CompanySettingsService } from './company-settings.service';
import { CompanySettings } from 'src/entities';

@ApiTags('company-settings')
@ApiBearerAuth()
@Controller('company-settings')
export class CompanySettingsController {
  constructor(private readonly service: CompanySettingsService) {}

  // Lectura: cualquier autenticado (se usa en encabezados/PDFs).
  @Get()
  get() {
    return this.service.get();
  }

  // Escritura: solo admin.
  @Put()
  @UseGuards(AdminGuard)
  update(@Body() dto: Partial<CompanySettings>) {
    return this.service.update(dto);
  }
}
