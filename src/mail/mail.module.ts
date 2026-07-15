import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { DocumentsModule } from 'src/documents/documents.module';
import { MailService } from './mail.service';

@Module({
  imports: [
    DocumentsModule,
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
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
