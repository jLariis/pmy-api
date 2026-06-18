import { Controller, Get, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Feed de notificaciones del usuario (por sucursal; superadmin ve todo + sesiones). */
  @Get()
  getFeed(@Request() req, @Query('limit') limit?: string) {
    return this.notifications.getFeed(req.user, Number(limit) || 30);
  }

  /** Marca todo como leído (resetea el contador). */
  @Post('mark-read')
  markRead(@Request() req) {
    return this.notifications.markAllRead(req.user?.userId);
  }
}
