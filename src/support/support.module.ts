import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { SupportTicketCommentAttachment } from 'src/entities/support-ticket-comment-attachment.entity';
import { SupportTicketRead } from 'src/entities/support-ticket-read.entity';
import { SupportZoneAuthorizer } from 'src/entities/support-zone-authorizer.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { User } from 'src/entities/user.entity';
import { SupportService } from './support.service';
import { SupportApprovalService } from './support-approval.service';
import { SupportController } from './support.controller';
import { SupportSlaCron } from './support-sla.cron';
import { CodeLocatorService } from './code-locator.service';
import { AiModule } from 'src/ai/ai.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportTicket, SupportTicketComment, SupportTicketAttachment, SupportTicketCommentAttachment, SupportTicketRead, SupportZoneAuthorizer, Subsidiary, User]),
    NotificationsModule,
    AiModule,
  ],
  controllers: [SupportController],
  providers: [SupportService, SupportApprovalService, SupportSlaCron, CodeLocatorService],
})
export class SupportModule {}
