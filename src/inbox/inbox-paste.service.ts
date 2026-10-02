import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { workbookToTsv } from './attachment-classify.util';
import { buildPastePlan, hmoDay, PasteBatch, PasteBatchKind } from './paste-plan.util';
import { uploadMinutes } from './zip-coverage.util';
import { ConsolidationKind } from './inbox.types';

const TSV_KINDS = ['master', 'master_aereo', 'f2', 'high_value'];

export interface PastePlanResult {
  /** Se puede mandar sin otra confirmación (sucursal confirmada o detectada segura). */
  ready: boolean;
  reason: string | null;
  batches: PasteBatch[];
}

/**
 * Bandeja → "Pegar FedEx": arma los lotes del correo para abrir el pegado ya lleno
 * y registra cuando se mandó (el tablero lo muestra como "subido desde correo").
 */
@Injectable()
export class InboxPasteService {
  constructor(
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly ds: DataSource,
  ) {}

  /** Master de esa sucursal ese día: primero el subido al sistema, luego el anunciado por otro correo. */
  private async dayMaster(subsidiaryId: string | null, day: string): Promise<string | null> {
    if (!subsidiaryId) return null;
    const uploaded: any[] = await this.ds.query(
      `SELECT consNumber FROM consolidated
       WHERE subsidiaryId = ? AND active = 1 AND consNumber IS NOT NULL AND consNumber <> ''
         AND DATE(date) = ? ORDER BY createdAt DESC LIMIT 1`,
      [subsidiaryId, day],
    );
    if (uploaded[0]?.consNumber) return uploaded[0].consNumber;
    const start = new Date(`${day}T07:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    const announced = await this.consRepo
      .createQueryBuilder('c')
      .where('c.subsidiaryId = :s AND c.kind = :k AND c.receivedAt >= :a AND c.receivedAt < :b', { s: subsidiaryId, k: 'master', a: start, b: end })
      .orderBy('c.receivedAt', 'DESC')
      .getOne();
    return announced?.consNumber ?? null;
  }

  async plan(messageId: string): Promise<PastePlanResult> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('No se encontró ese correo');
    const atts = await this.attRepo.find({ where: { inboxMessageId: messageId } });
    const cons = await this.consRepo.find({ where: { inboxMessageId: messageId } });

    const planAtts = [];
    for (const a of atts) {
      let tsv: string | null = null;
      if (TSV_KINDS.includes(a.kind)) {
        try {
          tsv = workbookToTsv(await fs.readFile(join(process.cwd(), a.storagePath)));
        } catch {
          tsv = null;
        }
      }
      planAtts.push({ id: a.id, filename: a.filename, kind: a.kind, consNumber: a.consNumber, tsv });
    }

    const batches = buildPastePlan({
      subsidiaryId: msg.subsidiaryId,
      receivedAt: msg.receivedAt,
      attachments: planAtts,
      announced: cons.map((c) => ({ consNumber: c.consNumber, kind: c.kind })),
      cobros: cons.flatMap((c) => c.cobros ?? []),
      dayMasterConsNumber: await this.dayMaster(msg.subsidiaryId, hmoDay(msg.receivedAt)),
      doneKeys: atts.filter((a) => a.pastedAt).map((a) => `${a.kind === 'master_aereo' ? 'aereo' : a.kind}:${a.id}`),
    });

    const ready = msg.status === 'confirmado' || msg.status === 'detectado';
    const reason =
      msg.status === 'ignorado'
        ? 'Este correo está ignorado'
        : msg.status === 'error'
          ? 'Este correo no se pudo leer'
          : ready
            ? null
            : 'Primero confirma la sucursal';
    return { ready, reason, batches };
  }

  /** Registra que un lote se mandó y subió desde el pegado. */
  async markPasted(messageId: string, body: { attachmentId: string; kind: PasteBatchKind; consNumber: string }, userId: string | null): Promise<void> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('No se encontró ese correo');
    const att = await this.attRepo.findOne({ where: { id: body?.attachmentId, inboxMessageId: messageId } });
    if (!att) throw new BadRequestException('Ese archivo no es de este correo');
    att.pastedAt = new Date();
    att.pastedById = userId;
    await this.attRepo.save(att);

    const consNumber = String(body.consNumber ?? '').trim();
    if (!consNumber) return;
    const kind: ConsolidationKind = body.kind === 'aereo' ? 'aereo' : body.kind === 'f2' ? 'f2' : 'master';
    const now = new Date();
    let c = await this.consRepo.findOne({ where: { consNumber, kind } });
    if (!c) {
      c = this.consRepo.create({ inboxMessageId: messageId, consNumber, kind, subsidiaryId: msg.subsidiaryId, receivedAt: msg.receivedAt, announcedCount: null, cobros: null });
    }
    c.uploadedAt = c.uploadedAt ?? now;
    c.uploadedById = c.uploadedById ?? userId;
    c.uploadedVia = 'correo';
    c.uploadMinutes = c.uploadMinutes ?? uploadMinutes(c.receivedAt, now);
    c.linkStatus = 'subido';
    await this.consRepo.save(c);
  }
}
