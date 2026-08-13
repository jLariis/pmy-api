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
      // Teléfono destino: el que el evento indique (p. ej. el del agente asignado)
      // con fallback al número de soporte global.
      const phone = (event.data?.whatsappTo as string | undefined) || process.env.SUPPORT_WHATSAPP;
      if (phone) {
        try {
          await this.whatsapp.sendText(phone, `*${event.title ?? 'PMY'}*\n${event.body ?? ''}`.trim());
        } catch (e: any) {
          this.logger.warn(`whatsapp falló: ${e?.message}`);
        }
      }
    }
  }

  /** Estado operativo de cada canal lateral (para diagnóstico de soporte). */
  channelHealth() {
    const emailConfigured = !!(
      process.env.EMAIL_SERVICE_HOST && process.env.EMAIL_SERVICE_EMAIL && process.env.EMAIL_SERVICE_PASSWORD
    );
    const wa = this.whatsapp.getStatus();
    const waPhone = process.env.SUPPORT_WHATSAPP;
    return {
      bell: { ready: true, detail: 'Notificaciones dentro de la app (siempre disponible).' },
      email: {
        ready: emailConfigured,
        detail: emailConfigured
          ? `SMTP ${process.env.EMAIL_SERVICE_HOST}`
          : 'Falta configurar EMAIL_SERVICE_HOST / EMAIL / PASSWORD.',
      },
      whatsapp: {
        ready: wa.status === 'connected' && !!waPhone,
        status: wa.status,
        detail:
          wa.status === 'connected'
            ? waPhone
              ? `Conectado (${wa.me ?? 'sin número'})`
              : 'Conectado, pero falta SUPPORT_WHATSAPP (número destino).'
            : `Gateway ${wa.status}${wa.lastError ? ` — ${wa.lastError}` : ''}. Vincular por QR.`,
      },
    };
  }

  /** Envía una notificación de prueba por email y WhatsApp; reporta por canal. */
  async sendTest(recipient: { email?: string | null; phone?: string | null }) {
    const out: Record<string, { sent: boolean; error?: string }> = {};

    if (recipient.email) {
      try {
        await this.mailer.sendMail({
          to: recipient.email,
          subject: 'Prueba de canal — Soporte PMY',
          html: '<p>Esta es una <b>notificación de prueba</b> del canal de correo de Soporte PMY.</p>',
        });
        out.email = { sent: true };
      } catch (e: any) {
        out.email = { sent: false, error: e?.message ?? 'error' };
      }
    } else {
      out.email = { sent: false, error: 'El destinatario no tiene correo.' };
    }

    const phone = recipient.phone || process.env.SUPPORT_WHATSAPP;
    if (phone) {
      try {
        await this.whatsapp.sendText(phone, '*PMY Soporte*\nNotificación de prueba del canal WhatsApp.');
        out.whatsapp = { sent: true };
      } catch (e: any) {
        out.whatsapp = { sent: false, error: e?.message ?? 'error' };
      }
    } else {
      out.whatsapp = { sent: false, error: 'No hay número de WhatsApp (SUPPORT_WHATSAPP).' };
    }

    return out;
  }

  private async renderEmail(event: NotificationEvent): Promise<{ subject: string; html: string }> {
    try {
      const link = event.link ? `${process.env.FRONTEND_URL ?? ''}${event.link}` : undefined;
      const r = await this.templates.render('generic_notification', { title: event.title, body: event.body, link });
      return { subject: r.subject ?? event.title ?? 'Notificación PMY', html: r.html ?? '' };
    } catch (e: any) {
      this.logger.warn(`no se pudo renderizar el email: ${e?.message}`);
      return { subject: event.title ?? 'Notificación PMY', html: '' };
    }
  }
}
