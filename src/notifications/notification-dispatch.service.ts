import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { User } from 'src/entities/user.entity';
import { WhatsappGatewayService } from 'src/whatsapp-gateway/whatsapp-gateway.service';
import { Channel, NotificationEvent } from './notification.types';

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly whatsapp: WhatsappGatewayService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
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
      const html = this.buildEmailHtml(event);
      for (const u of recipients) {
        if (!u.email) continue;
        try {
          await this.mailer.sendMail({ to: u.email, subject: event.title || 'Notificación PMY', html });
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

  private buildEmailHtml(event: NotificationEvent): string {
    const link = event.link ? `${process.env.FRONTEND_URL ?? ''}${event.link}` : null;
    return `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <h2 style="margin:0 0 8px">${event.title ?? 'Notificación'}</h2>
        <p style="margin:0 0 16px;color:#475569">${event.body ?? ''}</p>
        ${link ? `<a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Abrir en PMY</a>` : ''}
        <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">PMY App · notificación automática</p>
      </div>`;
  }
}
