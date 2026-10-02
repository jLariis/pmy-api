import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxDetection } from '../entities/inbox-detection.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { InboxSyncState } from '../entities/inbox-sync-state.entity';
import { ImapReaderService, RawMail } from './imap-reader.service';
import { KnowledgeService } from './knowledge.service';
import { analyzeMail, isAllowedSender, MailConsolidation, mergeConsolidations } from './mail-analysis';
import { detect } from './detector';
import { attachmentConsNumber, classifyByName, finalizeKinds, isSpreadsheet } from './attachment-classify.util';
import { Cobro, ConsolidationKind, DetectionResult } from './inbox.types';

export interface SyncReport {
  skipped?: string;
  read: number;
  saved: number;
  ignored: number;
  duplicates: number;
  errors: number;
  reset: boolean;
}

const MAX_ATTEMPTS = 3;

/**
 * Orquesta la bandeja FedEx: lee el buzón (solo lectura), guarda correos y
 * adjuntos (en disco), corre el detector y registra los consolidados anunciados.
 */
@Injectable()
export class InboxIngestService {
  private readonly logger = new Logger(InboxIngestService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly imap: ImapReaderService,
    private readonly knowledge: KnowledgeService,
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxDetection) private readonly detRepo: Repository<InboxDetection>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    @InjectRepository(InboxSyncState) private readonly stateRepo: Repository<InboxSyncState>,
  ) {}

  private allowedDomains(): string[] {
    return (this.config.get<string>('INBOX_ALLOWED_DOMAINS') || 'fedex.com').split(',').map((d) => d.trim()).filter(Boolean);
  }

  private storageBase(): string {
    return this.config.get<string>('INBOX_STORAGE_DIR') || join('uploads', 'inbox');
  }

  envEnabled(): boolean {
    return String(this.config.get('INBOX_ENABLED') ?? 'false') === 'true';
  }

  async getState(): Promise<InboxSyncState> {
    const mailbox = this.imap.mailbox();
    let s = await this.stateRepo.findOne({ where: { mailbox } });
    if (!s) s = await this.stateRepo.save(this.stateRepo.create({ mailbox, lastUid: 0, enabled: false }));
    return s;
  }

  async setEnabled(enabled: boolean): Promise<InboxSyncState> {
    const s = await this.getState();
    s.enabled = enabled;
    return this.stateRepo.save(s);
  }

  /** Una vuelta de lectura. `manual` ignora el interruptor (botón "Leer correo ahora"). */
  async runSync(manual = false): Promise<SyncReport> {
    const empty: SyncReport = { read: 0, saved: 0, ignored: 0, duplicates: 0, errors: 0, reset: false };
    if (this.running) return { ...empty, skipped: 'Ya hay una lectura en curso' };
    if (!this.imap.isConfigured()) return { ...empty, skipped: 'Falta configurar el acceso al correo en el servidor' };
    const state = await this.getState();
    if (!manual && (!this.envEnabled() || !state.enabled)) return { ...empty, skipped: 'La lectura automática está pausada' };

    this.running = true;
    const report = { ...empty };
    state.lastRunAt = new Date();
    try {
      const { uidValidity, mails, reset } = await this.imap.fetchNew({
        mailbox: state.mailbox,
        uidValidity: state.uidValidity,
        lastUid: state.lastUid,
        backfillDays: Number(this.config.get('INBOX_BACKFILL_DAYS') ?? 30),
        maxPerRun: Number(this.config.get('INBOX_MAX_PER_RUN') ?? 150),
      });
      report.reset = reset;
      if (reset) state.lastUid = 0;
      state.uidValidity = uidValidity;
      for (const m of mails) {
        report.read++;
        const r = await this.ingestRaw(m, state.mailbox);
        report[r]++;
        state.lastUid = Math.max(state.lastUid, m.uid);
        await this.stateRepo.save(state);
      }
      await this.retryErrors(state.mailbox, uidValidity);
      state.lastOkAt = new Date();
      state.lastError = null;
    } catch (e: any) {
      state.lastError = `No se pudo leer el correo: ${e?.message ?? e}`;
      this.logger.error(`📭 [inbox] ${state.lastError}`);
    } finally {
      await this.stateRepo.save(state);
      this.running = false;
    }
    if (report.read) {
      this.logger.log(`📬 [inbox] leídos=${report.read} guardados=${report.saved} ignorados=${report.ignored} repetidos=${report.duplicates} errores=${report.errors}`);
    }
    return report;
  }

  /** Reintenta correos que fallaron (máx. 3 intentos). */
  private async retryErrors(mailbox: string, uidValidity: string): Promise<void> {
    const failed = await this.msgRepo.find({ where: { mailbox, uidValidity, status: 'error' }, take: 20 });
    const pending = failed.filter((f) => f.attempts < MAX_ATTEMPTS);
    if (!pending.length) return;
    const mails = await this.imap.fetchUids(mailbox, pending.map((p) => p.uid));
    for (const m of mails) await this.ingestRaw(m, mailbox);
  }

  async ingestRaw(raw: RawMail, mailbox: string): Promise<'saved' | 'ignored' | 'duplicates' | 'errors'> {
    const prevError = await this.msgRepo.findOne({ where: { mailbox, uidValidity: raw.uidValidity, uid: raw.uid } });
    if (prevError && prevError.status !== 'error') return 'duplicates';
    try {
      const a = await analyzeMail(raw.source, raw.internalDate);
      const dup = await this.msgRepo.findOne({ where: { messageId: a.messageId } });
      if (dup && dup.id !== prevError?.id) return 'duplicates';

      const msg = prevError ?? this.msgRepo.create({ mailbox, uidValidity: raw.uidValidity, uid: raw.uid });
      Object.assign(msg, {
        messageId: a.messageId,
        fromAddress: a.fromAddress || '(sin remitente)',
        fromName: a.fromName,
        toAddresses: a.to,
        ccAddresses: a.cc,
        subject: (a.subject || '').slice(0, 990),
        receivedAt: a.date ?? raw.internalDate ?? new Date(),
        errorMessage: null,
      });

      if (!isAllowedSender(a.fromAddress, this.allowedDomains())) {
        msg.status = 'ignorado';
        msg.ignoreReason = 'No viene de FedEx';
        await this.msgRepo.save(msg);
        return 'ignored';
      }

      msg.textTop = a.textTop;
      msg.htmlSafe = a.htmlSafe;
      msg.hasQuotedHistory = a.hadHistory;
      msg.status = 'nuevo';
      const saved = await this.msgRepo.save(msg);

      await this.attRepo.delete({ inboxMessageId: saved.id });
      const relDir = join(this.storageBase(), saved.receivedAt.toISOString().slice(0, 7).replace('-', '/'), saved.id);
      await fs.mkdir(join(process.cwd(), relDir), { recursive: true });
      const attRows: InboxAttachment[] = [];
      for (const [i, att] of a.attachments.entries()) {
        const rel = join(relDir, `${i + 1}-${att.filename.replace(/[^\w.\-]+/g, '_').slice(0, 120)}`);
        await fs.writeFile(join(process.cwd(), rel), att.content);
        attRows.push(
          this.attRepo.create({
            inboxMessageId: saved.id,
            filename: att.filename.slice(0, 250),
            contentType: att.contentType.slice(0, 150),
            size: att.size,
            sha256: att.sha256,
            storagePath: rel,
            kind: att.kind,
            kindSource: att.kindSource,
            consNumber: att.consNumber,
            rowCount: att.summary?.rowCount ?? null,
            zipSummary: att.summary?.zips ?? null,
            citySummary: att.summary?.cities ?? null,
            parseError: att.summary?.parseError ?? null,
          }),
        );
      }
      await this.attRepo.save(attRows);
      await this.detectAndRecord(saved, attRows, a.consolidations, a.cobros);
      return 'saved';
    } catch (e: any) {
      const msg =
        prevError ??
        this.msgRepo.create({
          mailbox,
          uidValidity: raw.uidValidity,
          uid: raw.uid,
          messageId: `<error-${raw.uidValidity}-${raw.uid}@pmy>`,
          fromAddress: '(no se pudo leer)',
          subject: '',
          receivedAt: raw.internalDate ?? new Date(),
        });
      msg.status = 'error';
      msg.attempts = (msg.attempts ?? 0) + 1;
      msg.errorMessage = `No se pudo procesar este correo: ${e?.message ?? e}`.slice(0, 2000);
      await this.msgRepo.save(msg);
      this.logger.warn(`📭 [inbox] uid=${raw.uid} ${msg.errorMessage}`);
      return 'errors';
    }
  }

  /** Corre el detector y actualiza el correo y sus consolidados. */
  async detectAndRecord(
    msg: InboxMessage,
    atts: InboxAttachment[],
    consolidations: MailConsolidation[],
    cobros: Cobro[],
  ): Promise<DetectionResult> {
    const consNumbers = [...new Set([...consolidations.map((c) => c.consNumber), ...atts.map((a) => a.consNumber).filter((x): x is string => !!x)])];
    const knowledge = await this.knowledge.load(consNumbers);
    const r = detect({
      subject: msg.subject,
      top: msg.textTop ?? '',
      fromAddress: msg.fromAddress,
      ccAddresses: msg.ccAddresses ?? [],
      attachments: atts.map((a) => ({ filename: a.filename, kind: a.kind, zips: a.zipSummary ?? {}, cities: a.citySummary ?? {} })),
      consNumbers,
      knowledge,
    });
    await this.detRepo.save(
      this.detRepo.create({
        inboxMessageId: msg.id,
        subsidiaryId: r.subsidiaryId,
        confidence: String(r.confidence),
        autoSafe: r.autoSafe,
        signals: r.signals,
        runnerUp: r.runnerUp,
        reason: r.reason.slice(0, 500),
        detectorVersion: r.detectorVersion,
      }),
    );
    if (msg.status !== 'confirmado') {
      msg.status = r.autoSafe ? 'detectado' : 'revision';
      msg.subsidiaryId = r.subsidiaryId;
      await this.msgRepo.save(msg);
    }
    await this.recordConsolidations(msg, consolidations, cobros);
    return r;
  }

  private async recordConsolidations(msg: InboxMessage, list: MailConsolidation[], cobros: Cobro[]): Promise<void> {
    const cobrosOwner = list.find((c) => c.kind === 'master') ?? list[0];
    for (const c of list) {
      const kind = c.kind as ConsolidationKind;
      const existing = await this.consRepo.findOne({ where: { consNumber: c.consNumber, kind } });
      if (existing) {
        if (msg.receivedAt < existing.receivedAt) {
          existing.receivedAt = msg.receivedAt;
          existing.inboxMessageId = msg.id;
        }
        if (existing.inboxMessageId === msg.id || !existing.subsidiaryId) existing.subsidiaryId = msg.subsidiaryId;
        existing.announcedCount = existing.announcedCount ?? c.announcedCount;
        if (c === cobrosOwner && cobros.length) existing.cobros = cobros;
        await this.consRepo.save(existing);
      } else {
        await this.consRepo.save(
          this.consRepo.create({
            inboxMessageId: msg.id,
            consNumber: c.consNumber,
            kind,
            subsidiaryId: msg.subsidiaryId,
            announcedCount: c.announcedCount,
            cobros: c === cobrosOwner && cobros.length ? cobros : null,
            receivedAt: msg.receivedAt,
            linkStatus: 'pendiente',
          }),
        );
      }
    }
  }

  /** Vuelve a clasificar los archivos con las reglas actuales (respeta los cambiados a mano). */
  private async reclassify(atts: InboxAttachment[]): Promise<void> {
    if (!atts.length) return;
    // Número de consolidado de la fila meta para archivos guardados antes de esta regla.
    for (const a of atts) {
      if (a.consNumber) continue;
      try {
        const n = attachmentConsNumber(a.filename, a.kind, await fs.readFile(join(process.cwd(), a.storagePath)));
        if (n) {
          a.consNumber = n;
          await this.attRepo.save(a);
        }
      } catch {
        // archivo ya no está en disco: se deja como estaba
      }
    }
    if (atts.some((a) => a.kindSource === 'manual')) return;
    const kinds = finalizeKinds(
      atts.map((a) => ({
        filename: a.filename,
        byName: classifyByName(a.filename),
        summary: isSpreadsheet(a.filename)
          ? { rowCount: a.rowCount ?? 0, zips: a.zipSummary ?? {}, cities: a.citySummary ?? {}, looksFedex: (a.rowCount ?? 0) > 0, isDhl: a.kind === 'dhl' }
          : null,
      })),
    );
    const changed = atts.filter((a, i) => a.kind !== kinds[i]);
    atts.forEach((a, i) => (a.kind = kinds[i]));
    if (changed.length) await this.attRepo.save(changed);
  }

  /** Re-evalúa correos no confirmados (p. ej. tras aprender o mejorar el detector). */
  async redetect(ids?: string[]): Promise<{ updated: number }> {
    const where: any = ids?.length ? { id: In(ids) } : { status: In(['detectado', 'revision', 'nuevo', 'confirmado']) };
    const msgs = await this.msgRepo.find({ where, take: ids?.length ? undefined : 500, order: { receivedAt: 'DESC' } });
    let updated = 0;
    for (const m of msgs) {
      if (m.status === 'ignorado' || m.status === 'error') continue;
      const atts = await this.attRepo.find({ where: { inboxMessageId: m.id } });
      await this.reclassify(atts);
      const cons = await this.consRepo.find({ where: { inboxMessageId: m.id } });
      const mc: MailConsolidation[] = cons.map((c) => ({ consNumber: c.consNumber, kind: c.kind, announcedCount: c.announcedCount }));
      // Suma los consolidados de los archivos (p. ej. el aéreo con su número en la fila meta).
      for (const extra of mergeConsolidations([], atts)) {
        if (!mc.some((x) => x.consNumber === extra.consNumber)) mc.push(extra);
      }
      await this.detectAndRecord(m, atts, mc, cons.find((c) => c.cobros?.length)?.cobros ?? []);
      updated++;
    }
    return { updated };
  }
}
