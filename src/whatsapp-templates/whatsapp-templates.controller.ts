import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { WhatsappTemplate } from 'src/entities';

@ApiTags('whatsapp-templates')
@ApiBearerAuth()
@Controller('whatsapp-templates')
export class WhatsappTemplatesController {
  constructor(private readonly service: WhatsappTemplatesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: Partial<WhatsappTemplate>) {
    return this.service.create(dto);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: Partial<WhatsappTemplate>) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
