import { Body, Controller, Get, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { WhatsappGatewayService } from './whatsapp-gateway.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappGatewayController {
  constructor(
    private readonly gateway: WhatsappGatewayService,
  ) {}

  /** Estado de la conexión + QR (si está pendiente de vincular). Solo admin. */
  @Get('status')
  @UseGuards(AdminGuard)
  status() {
    return this.gateway.getStatus();
  }

  /** Inicia la vinculación (genera QR). Solo admin. */
  @Post('link')
  @UseGuards(AdminGuard)
  link() {
    return this.gateway.link();
  }

  /** Desvincula la cuenta y borra la sesión local. Solo admin. */
  @Post('logout')
  @UseGuards(AdminGuard)
  logout() {
    return this.gateway.logout();
  }

  /**
   * Envía un mensaje. Cualquier usuario autenticado (el monitoreo lo usa).
   * El número destino `to` es obligatorio: el frontend lo resuelve al enviar
   * (custom / chofer / encargado).
   */
  @Post('send')
  async send(@Body() dto: { message?: string; to?: string }) {
    const message = (dto?.message || '').trim();
    if (!message) throw new BadRequestException('El mensaje no puede estar vacío.');
    const to = (dto?.to || '').replace(/\D/g, '');
    if (!to) throw new BadRequestException('Falta el número destino.');
    return this.gateway.sendText(to, message);
  }
}
