import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { join } from 'path';

MailerModule.forRoot({
  transport: {
    host: process.env.EMAIL_SERVICE_HOST,
    port: process.env.EMAIL_SERVICE_PORT, // o 587
    secure: process.env.EMAIL_SERVICE_SECURE, // true para 465, false para 587
    requireTLS: true,
    auth: {
      user: process.env.EMAIL_SERVICE_EMAIL,
      pass: process.env.EMAIL_SERVICE_PASSWORD,
    },
  },
  defaults: {
    from: `"PMY App" <${process.env.EMAIL_SERVICE_EMAIL}>`,
  },
  /*template: {
    dir: join(__dirname, '..', 'templates'),
    adapter: new HandlebarsAdapter(),
    options: {
      strict: true,
    },
  },***** sin template por ahora ****/
})
