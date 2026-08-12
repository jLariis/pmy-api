import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { EmailLog } from 'src/entities/email-log.entity';
import { EmailAttachment } from 'src/entities/email-attachment.entity';
import { EmailStatus } from 'src/common/enums/email-status.enum';

/** Adjunto tal como lo maneja MailService / nodemailer. */
export interface EmailFile {
  filename: string;
  content: Buffer;
  mimeType?: string;
}

/** Datos para registrar un intento de envío en la bitácora. */
export interface RecordEmailInput {
  module: string;
  /** Tipo/origen del correo, p.ej. 'route_dispatch', 'unloading'. */
  emailType?: string;
  entityId: string;
  /** Folio/guía legible de la entidad origen. */
  referenceTracking?: string | null;
  subsidiaryId?: string | null;
  subsidiaryName?: string | null;
  to: string | string[];
  cc?: string | string[] | null;
  subject: string;
  status: EmailStatus;
  error?: string | null;
  messageId?: string | null;
  rejected?: string[] | null;
  isResend?: boolean;
  triggeredById?: string | null;
  triggeredByName?: string | null;
  attachmentsMeta?: { filename: string; size: number }[] | null;
}

/**
 * Servicio GENÉRICO de trazabilidad de correo. Opera solo por (`module`,
 * `entityId`); no conoce ningún módulo en concreto, para poder reutilizarse.
 * Los adjuntos se guardan en disco bajo `uploads/email/<module>/<entityId>/`.
 */
@Injectable()
export class EmailLogService {
  private readonly logger = new Logger(EmailLogService.name);

  constructor(
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    @InjectRepository(EmailAttachment)
    private readonly emailAttachmentRepository: Repository<EmailAttachment>,
  ) {}

  /** Raíz relativa (a process.cwd()) donde viven los adjuntos de una entidad. */
  private relDir(module: string, entityId: string): string {
    return join('uploads', 'email', module, entityId);
  }

  private abs(relativePath: string): string {
    return join(process.cwd(), relativePath);
  }

  private joinRecipients(value?: string | string[] | null): string | null {
    if (!value) return null;
    return Array.isArray(value) ? value.filter(Boolean).join(', ') : value;
  }

  /**
   * Escribe los adjuntos a disco y registra un renglón `email_attachment` por
   * archivo. Idempotente: reemplaza cualquier registro/carpeta previa de la
   * entidad (útil para el fallback que regenera documentos).
   */
  async persistAttachments(module: string, entityId: string, files: EmailFile[]): Promise<void> {
    if (!files?.length) return;

    // Limpia registros previos (los archivos se sobrescriben por nombre).
    await this.emailAttachmentRepository.delete({ module, entityId });

    const relDir = this.relDir(module, entityId);
    await fs.mkdir(this.abs(relDir), { recursive: true });

    const rows: EmailAttachment[] = [];
    for (const file of files) {
      const relPath = join(relDir, file.filename);
      await fs.writeFile(this.abs(relPath), file.content);
      rows.push(
        this.emailAttachmentRepository.create({
          module,
          entityId,
          filename: file.filename,
          mimeType: file.mimeType || 'application/octet-stream',
          size: file.content.length,
          storagePath: relPath,
        }),
      );
    }
    await this.emailAttachmentRepository.save(rows);
  }

  /**
   * Lee de disco los adjuntos registrados. Devuelve `null` si no hay registros
   * o si algún archivo ya no existe en disco (fue purgado): el llamador debe
   * usar entonces su fallback de regeneración.
   */
  async loadAttachments(module: string, entityId: string): Promise<EmailFile[] | null> {
    const rows = await this.emailAttachmentRepository.find({ where: { module, entityId } });
    if (!rows.length) return null;

    const files: EmailFile[] = [];
    for (const row of rows) {
      try {
        const content = await fs.readFile(this.abs(row.storagePath));
        files.push({ filename: row.filename, content, mimeType: row.mimeType });
      } catch (e: any) {
        this.logger.warn(
          `Adjunto ausente en disco (${module}/${entityId} -> ${row.storagePath}); se usará fallback: ${e?.message}`,
        );
        return null;
      }
    }
    return files;
  }

  /** Escribe un renglón en la bitácora de envíos. */
  async record(input: RecordEmailInput): Promise<EmailLog> {
    const entry = this.emailLogRepository.create({
      module: input.module,
      emailType: input.emailType ?? 'unknown',
      entityId: input.entityId,
      referenceTracking: input.referenceTracking ?? null,
      subsidiaryId: input.subsidiaryId ?? null,
      subsidiaryName: input.subsidiaryName ?? null,
      to: this.joinRecipients(input.to) ?? '',
      cc: this.joinRecipients(input.cc),
      subject: input.subject,
      status: input.status,
      error: input.error ?? null,
      messageId: input.messageId ?? null,
      rejected: input.rejected?.length ? input.rejected.join(', ') : null,
      isResend: input.isResend ?? false,
      triggeredById: input.triggeredById ?? null,
      triggeredByName: input.triggeredByName ?? null,
      attachmentsMeta: input.attachmentsMeta ?? null,
    });
    return this.emailLogRepository.save(entry);
  }

  /** Historial de envíos de una entidad, del más reciente al más antiguo. */
  async getHistory(module: string, entityId: string): Promise<EmailLog[]> {
    return this.emailLogRepository.find({
      where: { module, entityId },
      order: { createdAt: 'DESC' },
    });
  }
}
