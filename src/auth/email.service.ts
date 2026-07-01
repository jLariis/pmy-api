import { Injectable } from "@nestjs/common";
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            service: 'Outlook365',
            //port: 587,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }

    async sendPasswordResetEmail(to: string, token: string): Promise<void> {
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
        const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: 'Password Reset Request',
        text: `To reset your password, please click the following link: ${resetLink}`,
        };

        await this.transporter.sendMail(mailOptions);
    }

    /** Envía el código OTP para recuperación de contraseña. */
    async sendOtpEmail(to: string, code: string, minutes = 10): Promise<void> {
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
            <h2 style="margin:0 0 8px">Recuperación de contraseña — PMY App</h2>
            <p style="margin:0 0 16px;color:#475569">Usa este código para restablecer tu contraseña. Vence en ${minutes} minutos.</p>
            <div style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;background:#f1f5f9;border-radius:12px;padding:16px 0;margin:8px 0 16px">${code}</div>
            <p style="margin:0;color:#94a3b8;font-size:12px">Si no solicitaste este código, ignora este correo.</p>
          </div>`;
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to,
            subject: `Tu código de recuperación: ${code}`,
            text: `Tu código de recuperación de PMY App es ${code}. Vence en ${minutes} minutos.`,
            html,
        };
        await this.transporter.sendMail(mailOptions);
    }
}