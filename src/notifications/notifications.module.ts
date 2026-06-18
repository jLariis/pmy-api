import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from 'src/entities/audit-log.entity';
import { NotificationRead } from 'src/entities/notification-read.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, NotificationRead])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
