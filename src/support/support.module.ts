import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportTicket, SupportTicketComment, SupportTicketAttachment]),
    NotificationsModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
