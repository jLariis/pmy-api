import { Injectable } from '@nestjs/common';
import { NotificationEvent, Channel } from './notification.types';

/**
 * Placeholder (Task 4 lo reemplaza con la implementación real de envío por
 * canal). Por ahora es un no-op para que `NotificationsService.emit()`
 * (Task 3) compile y funcione en aislamiento.
 */
@Injectable()
export class NotificationDispatchService {
  async deliver(event: NotificationEvent, recipientIds: string[], channels: Channel[]): Promise<void> {
    return;
  }
}
