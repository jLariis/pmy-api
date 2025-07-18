import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendHighPriorityShipmentsEmail(options: { to: string | string[], cc?: string | string[], htmlContent: string }) {
    const { to, cc, htmlContent } = options;
    
    try {
      await this.mailerService.sendMail({
        to,
        cc,
        subject: '🔴 Envíos con Prioridad Alta en Curso',
        html: htmlContent,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'High',
        },
      });
    } catch (error) {
      console.error('Error al enviar correo:', error);
      throw error;
    }
  }
}
