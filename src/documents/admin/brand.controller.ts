import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { TemplateAdminService } from './template-admin.service';
import { UpsertBrandDto } from './dto/template.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('documents/brand')
export class BrandController {
  constructor(private readonly admin: TemplateAdminService) {}

  @Get() get() { return this.admin.getBrand(); }

  @Put()
  upsert(@Body() dto: UpsertBrandDto, @Request() req) {
    return this.admin.upsertBrand(dto, { id: req.user?.userId, name: req.user?.name });
  }
}
