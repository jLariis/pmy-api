import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { isSpreadsheet, workbookSheets } from './attachment-classify.util';
import { combineDhlWorkbook } from '../utils/dhl-excel.util';
import { cleanTracking, guidesFromDhlBody, guidesFromSheets, IndexedGuide } from './guide-index.util';

/** Archivos que pueden traer guías (los CCP ignorados, PDF y "otro" no). */
const INDEX_KINDS = ['master', 'master_aereo', 'f2', 'high_value', 'dhl'];

/**
 * Llena `inbox_guide`: qué guías trae cada correo (archivo/hoja, cuerpo DHL y cobros anunciados).
 * Es lo que permite al buscador decir "esta guía llegó en este correo" aunque nunca se haya subido.
 */
@Injectable()
export class GuideIndexService {
  private readonly logger = new Logger(GuideIndexService.name);
  private running = false;

  constructor(
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly ds: DataSource,
  ) {}

  private async fromAttachment(a: InboxAttachment): Promise<IndexedGuide[]> {
    if (!isSpreadsheet(a.filename)) return [];
    let buf: Buffer;
    try {
      buf = await fs.readFile(join(process.cwd(), a.storagePath));
    } catch {
      return []; // el archivo ya no está en disco
    }
    const out = guidesFromSheets({ id: a.id, kind: a.kind, consNumber: a.consNumber }, workbookSheets(buf));
    if (a.kind === 'dhl' || !out.length) {
      // Excel DHL de 3 hojas: guía maestra + JD de cada pieza.
      try {
        for (const r of combineDhlWorkbook(XLSX.read(buf, { type: 'buffer' }))) {
          for (const raw of [r.trackingNumber, r.dhlUniqueId]) {
            const t = cleanTracking(raw);
            if (t && !out.some((g) => g.trackingNumber === t)) out.push({ inboxAttachmentId: a.id, sheet: null, unitKind: 'dhl', unitConsNumber: null, trackingNumber: t });
          }
        }
      } catch {
        /* no es libro DHL */
      }
    }
    return out;
  }

  /** (Re)indexa un correo completo. */
  async indexMessage(msg: InboxMessage): Promise<number> {
    const atts = await this.attRepo.find({ where: { inboxMessageId: msg.id } });
    const rows: IndexedGuide[] = [];
    for (const a of atts.filter((x) => INDEX_KINDS.includes(x.kind))) rows.push(...(await this.fromAttachment(a)));
    for (const t of guidesFromDhlBody(msg.textBody)) rows.push({ inboxAttachmentId: null, sheet: null, unitKind: 'dhl', unitConsNumber: null, trackingNumber: t });
    const cons = await this.consRepo.find({ where: { inboxMessageId: msg.id } });
    for (const c of cons)
      for (const cobro of c.cobros ?? []) {
        const t = cleanTracking(cobro.trackingNumber);
        if (t) rows.push({ inboxAttachmentId: null, sheet: null, unitKind: 'cobro', unitConsNumber: c.consNumber, trackingNumber: t });
      }

    await this.ds.transaction(async (m) => {
      await m.query('DELETE FROM inbox_guide WHERE inboxMessageId = ?', [msg.id]);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await m.query(
          `INSERT INTO inbox_guide (inboxMessageId, inboxAttachmentId, sheet, unitKind, unitConsNumber, trackingNumber) VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(',')}`,
          chunk.flatMap((g) => [msg.id, g.inboxAttachmentId, g.sheet, g.unitKind, g.unitConsNumber, g.trackingNumber]),
        );
      }
      await m.query('UPDATE inbox_message SET guidesIndexedAt = ? WHERE id = ?', [new Date(), msg.id]);
    });
    return rows.length;
  }

  /** Correos aún sin indexar, los más recientes primero (los viejos van entrando poco a poco). */
  async indexPending(limit = 150): Promise<{ messages: number; guides: number }> {
    if (this.running) return { messages: 0, guides: 0 };
    this.running = true;
    let messages = 0;
    let guides = 0;
    try {
      const pending = await this.msgRepo.find({ where: { guidesIndexedAt: IsNull() }, order: { receivedAt: 'DESC' }, take: limit });
      for (const m of pending) {
        try {
          guides += await this.indexMessage(m);
          messages++;
        } catch (e: any) {
          this.logger.warn(`[inbox] índice de guías ${m.id}: ${e?.message ?? e}`);
        }
      }
    } finally {
      this.running = false;
    }
    if (messages) this.logger.log(`🔎 [inbox] índice de guías: ${messages} correos, ${guides} guías`);
    return { messages, guides };
  }
}
