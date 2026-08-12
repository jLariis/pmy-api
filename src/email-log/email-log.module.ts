import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailLog } from 'src/entities/email-log.entity';
import { EmailAttachment } from 'src/entities/email-attachment.entity';
import { EmailLogService } from './email-log.service';

/**
 * Módulo genérico de trazabilidad de correo (bitácora + adjuntos en disco).
 * Cualquier módulo que envíe correo puede importarlo y usar EmailLogService.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmailLog, EmailAttachment])],
  providers: [EmailLogService],
  exports: [EmailLogService],
})
export class EmailLogModule {}
