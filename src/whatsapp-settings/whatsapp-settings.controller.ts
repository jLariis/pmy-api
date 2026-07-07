import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { WhatsappSettingsService } from './whatsapp-settings.service';
import { WhatsappSettings } from 'src/entities';

@ApiTags('whatsapp-settings')
@ApiBearerAuth()
@Controller('whatsapp-settings')
export class WhatsappSettingsController {
  constructor(private readonly service: WhatsappSettingsService) {}

  // Lectura: cualquier autenticado (el monitoreo la usa para armar el mensaje).
  @Get()
  get() {
    return this.service.get();
  }

  // Escritura: solo admin (número y plantilla los controla la administración).
  @Put()
  @UseGuards(AdminGuard)
  update(@Body() dto: Partial<WhatsappSettings>) {
    return this.service.update(dto);
  }
}
