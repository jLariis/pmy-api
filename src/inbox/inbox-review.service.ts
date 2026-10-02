import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { KnowledgeService } from './knowledge.service';
import { ZipCoverageService } from './zip-coverage.service';
import { AttachmentKind } from './inbox.types';
import { isSpreadsheet, previewWorkbook, SheetPreview } from './attachment-classify.util';

const KINDS: AttachmentKind[] = ['master', 'master_aereo', 'f2', 'high_value', 'ccp', 'ccp_ignored', 'dhl', 'pdf', 'other'];
const ZIP_KINDS: AttachmentKind[] = ['master', 'master_aereo', 'f2', 'high_value', 'dhl'];

/** Acciones de revisión: confirmar/corregir sucursal (y aprender), cambiar tipo, ignorar. */
@Injectable()
export class InboxReviewService {
  constructor(
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly knowledge: KnowledgeService,
    private readonly coverage: ZipCoverageService,
    private readonly ds: DataSource,
  ) {}

  private async message(id: string): Promise<InboxMessage> {
    const m = await this.msgRepo.findOne({ where: { id } });
    if (!m) throw new NotFoundException('No se encontró ese correo');
    return m;
  }

  async confirm(id: string, subsidiaryId: string, userId: string | null, kinds?: Record<string, AttachmentKind>): Promise<InboxMessage> {
    if (!subsidiaryId) throw new BadRequestException('Elige la sucursal');
    const sub: any[] = await this.ds.query('SELECT id FROM subsidiary WHERE id = ?', [subsidiaryId]);
    if (!sub.length) throw new BadRequestException('Esa sucursal no existe');
    const msg = await this.message(id);
    if (msg.status === 'error') throw new BadRequestException('Este correo no se pudo leer; no se puede confirmar');

    const atts = await this.attRepo.find({ where: { inboxMessageId: id } });
    if (kinds) {
      for (const a of atts) {
        const k = kinds[a.id];
        if (!k) continue;
        if (!KINDS.includes(k)) throw new BadRequestException('Tipo de archivo no válido');
        a.kind = k;
        a.kindSource = 'manual';
      }
      await this.attRepo.save(atts);
    }

    const previous = msg.status === 'confirmado' ? msg.subsidiaryId : null;
    await this.knowledge.learn(
      { fromAddress: msg.fromAddress, cc: msg.ccAddresses ?? [], subject: msg.subject, filenames: atts.map((a) => a.filename) },
      subsidiaryId,
      previous,
    );
    if (previous !== subsidiaryId) {
      const zips: Record<string, number> = {};
      for (const a of atts) {
        if (!ZIP_KINDS.includes(a.kind)) continue;
        for (const [z, n] of Object.entries(a.zipSummary ?? {})) zips[z] = (zips[z] ?? 0) + n;
      }
      await this.coverage.addFromConfirmed(zips, subsidiaryId);
      this.knowledge.invalidate();
    }

    msg.status = 'confirmado';
    msg.subsidiaryId = subsidiaryId;
    msg.confirmedById = userId;
    msg.confirmedAt = new Date();
    msg.ignoreReason = null;
    await this.msgRepo.save(msg);
    await this.consRepo.update({ inboxMessageId: id }, { subsidiaryId });
    return msg;
  }

  async ignore(id: string, reason?: string): Promise<InboxMessage> {
    const msg = await this.message(id);
    msg.status = 'ignorado';
    msg.ignoreReason = (reason || 'Marcado como no relevante').slice(0, 250);
    await this.consRepo.update({ inboxMessageId: id, linkStatus: 'pendiente' }, { linkStatus: 'no_aplica' });
    return this.msgRepo.save(msg);
  }

  /** Vista previa para abrir el archivo dentro de la app (hojas como tabla; PDF/imagen se muestran tal cual). */
  async preview(attachmentId: string): Promise<{ type: 'sheet' | 'pdf' | 'image' | 'none'; filename: string; sheets?: SheetPreview[] }> {
    const a = await this.attRepo.findOne({ where: { id: attachmentId } });
    if (!a) throw new NotFoundException('No se encontró el archivo');
    if (/\.pdf$/i.test(a.filename) || a.contentType === 'application/pdf') return { type: 'pdf', filename: a.filename };
    if (/^image\//.test(a.contentType)) return { type: 'image', filename: a.filename };
    if (!isSpreadsheet(a.filename)) return { type: 'none', filename: a.filename };
    try {
      const sheets = previewWorkbook(await fs.readFile(join(process.cwd(), a.storagePath)));
      return sheets.length ? { type: 'sheet', filename: a.filename, sheets } : { type: 'none', filename: a.filename };
    } catch {
      throw new NotFoundException('El archivo ya no está en el servidor');
    }
  }

  async download(attachmentId: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const a = await this.attRepo.findOne({ where: { id: attachmentId } });
    if (!a) throw new NotFoundException('No se encontró el archivo');
    try {
      const buffer = await fs.readFile(join(process.cwd(), a.storagePath));
      return { filename: a.filename, contentType: a.contentType, buffer };
    } catch {
      throw new NotFoundException('El archivo ya no está en el servidor');
    }
  }

  async attachmentMessageId(attachmentId: string): Promise<string | null> {
    const a = await this.attRepo.findOne({ where: { id: attachmentId }, select: ['id', 'inboxMessageId'] });
    return a?.inboxMessageId ?? null;
  }
}
