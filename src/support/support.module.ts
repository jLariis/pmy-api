import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { User } from 'src/entities/user.entity';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportSlaCron } from './support-sla.cron';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportTicket, SupportTicketComment, SupportTicketAttachment, User]),
    NotificationsModule,
  ],
  controllers: [SupportController],
  providers: [SupportService, SupportSlaCron],
})
export class SupportModule {}
