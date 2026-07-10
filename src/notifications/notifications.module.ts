import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from 'src/entities/audit-log.entity';
import { NotificationRead } from 'src/entities/notification-read.entity';
import { Notification } from 'src/entities/notification.entity';
import { User } from 'src/entities/user.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationDispatchService } from './notification-dispatch.service';
import { WhatsappGatewayModule } from 'src/whatsapp-gateway/whatsapp-gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, NotificationRead, Notification, User]),
    WhatsappGatewayModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationDispatchService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
