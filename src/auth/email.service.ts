import { Injectable } from "@nestjs/common";
import { MailerService } from '@nestjs-modules/mailer';
import { TemplateService } from 'src/documents/template.service';

@Injectable()
export class EmailService {
    constructor(
        private readonly templates: TemplateService,
        private readonly mailer: MailerService,
    ) {}

    async sendPasswordResetEmail(to: string, token: string): Promise<void> {
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
        const r = await this.templates.render('password_reset_link', { resetLink });
        await this.mailer.sendMail({ to, subject: r.subject ?? 'Password Reset Request', html: r.html });
    }

    /** Envía el código OTP para recuperación de contraseña. */
    async sendOtpEmail(to: string, code: string, minutes = 10): Promise<void> {
        const r = await this.templates.render('password_reset_otp', { code, minutes });
        await this.mailer.sendMail({ to, subject: r.subject ?? `Tu código de recuperación: ${code}`, html: r.html });
    }
}
