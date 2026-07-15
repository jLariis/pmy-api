import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { User } from 'src/entities/user.entity';
import { WhatsappGatewayService } from 'src/whatsapp-gateway/whatsapp-gateway.service';
import { TemplateService } from 'src/documents/template.service';
import { Channel, NotificationEvent } from './notification.types';

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly whatsapp: WhatsappGatewayService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly templates: TemplateService,
  ) {}

  /** Entrega canales laterales. Best-effort: cada canal aislado, jamás lanza. */
  async deliver(event: NotificationEvent, recipientIds: string[], channels: Channel[]): Promise<void> {
    const wantEmail = channels.includes('email');
    const wantWa = channels.includes('whatsapp');
    if (!wantEmail && !wantWa) return;

    let recipients: User[] = [];
    try {
      recipients = await this.userRepo.find({ where: { id: In(recipientIds) }, select: ['id', 'email', 'name'] });
    } catch (e: any) {
      this.logger.warn(`no se pudieron leer destinatarios: ${e?.message}`);
    }

    if (wantEmail) {
      const { subject, html } = await this.renderEmail(event);
      for (const u of recipients) {
        if (!u.email) continue;
        try {
          await this.mailer.sendMail({ to: u.email, subject, html });
        } catch (e: any) {
          this.logger.warn(`email a ${u.email} falló: ${e?.message}`);
        }
      }
    }

    if (wantWa) {
      const phone = process.env.SUPPORT_WHATSAPP;
      if (phone) {
        try {
          await this.whatsapp.sendText(phone, `*${event.title ?? 'PMY'}*\n${event.body ?? ''}`.trim());
        } catch (e: any) {
          this.logger.warn(`whatsapp falló: ${e?.message}`);
        }
      }
    }
  }

  private async renderEmail(event: NotificationEvent): Promise<{ subject: string; html: string }> {
    const link = event.link ? `${process.env.FRONTEND_URL ?? ''}${event.link}` : undefined;
    const r = await this.templates.render('generic_notification', { title: event.title, body: event.body, link });
    return { subject: r.subject ?? event.title ?? 'Notificación PMY', html: r.html ?? '' };
  }
}
