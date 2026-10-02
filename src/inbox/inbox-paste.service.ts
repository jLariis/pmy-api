import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { workbookSheets } from './attachment-classify.util';
import { buildPastePlan, expandWorkbook, PasteBatch, PasteBatchKind, PlanAttachment, tsvTrackings, WorkbookSheet } from './paste-plan.util';
import { uploadMinutes } from './zip-coverage.util';
import { ConsolidationKind } from './inbox.types';

const TSV_KINDS = ['master', 'master_aereo', 'f2', 'high_value'];

export interface PlanBatchView extends PasteBatch {
  hvCount: number;
  cobrosCount: number;
  /** Ya está en el sistema (por esta bandeja o subido por otro camino). */
  uploaded: { at: Date; byName: string | null; minutes: number | null; via: string | null } | null;
}

export interface PastePlanResult {
  /** Se puede mandar sin otra confirmación (sucursal confirmada o detectada segura). */
  ready: boolean;
  reason: string | null;
  batches: PlanBatchView[];
  /** Consolidados que el correo anuncia pero sin archivo adjunto (p. ej. COD, F2 o HV solo en el texto). */
  announcedOnly: {
    consNumber: string;
    kind: string;
    announcedCount: number | null;
    /** Hoja del libro master donde ya vienen ("COD" / "HV"); null = no vino archivo. */
    insideSheet: string | null;
    uploaded: { at: Date; byName: string | null; minutes: number | null } | null;
  }[];
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

  async plan(messageId: string): Promise<PastePlanResult> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('No se encontró ese correo');
    const atts = await this.attRepo.find({ where: { inboxMessageId: messageId } });
    const cons = await this.consRepo.find({ where: { inboxMessageId: messageId } });

    // Cada libro se reparte por hojas (YAQUI / F2 / COD / HV) antes de armar los bloques.
    const planAtts: PlanAttachment[] = [];
    const sheetRoles = new Set<string>();
    let extraPayments = '';
    for (const a of atts) {
      if (!TSV_KINDS.includes(a.kind)) continue;
      let sheets: WorkbookSheet[] = [];
      try {
        sheets = workbookSheets(await fs.readFile(join(process.cwd(), a.storagePath)));
      } catch {
        sheets = [];
      }
      const ex = expandWorkbook({ id: a.id, filename: a.filename, kind: a.kind, consNumber: a.consNumber }, sheets);
      planAtts.push(...ex.units);
      ex.roles.forEach((r) => sheetRoles.add(r));
      if (ex.extraPayments) extraPayments = [extraPayments, ex.extraPayments].filter(Boolean).join('\n');
    }

    const legacyKey = (a: InboxAttachment) => `${a.kind === 'master_aereo' ? 'aereo' : a.kind === 'high_value' ? 'master' : a.kind}:${a.id}`;
    const batches = buildPastePlan({
      subsidiaryId: msg.subsidiaryId,
      receivedAt: msg.receivedAt,
      attachments: planAtts,
      announced: cons.map((c) => ({ consNumber: c.consNumber, kind: c.kind })),
      cobros: cons.flatMap((c) => c.cobros ?? []),
      doneKeys: atts.flatMap((a) => [...(a.pastedKeys ?? []), ...(a.pastedAt && !a.pastedKeys?.length ? [legacyKey(a)] : [])]),
      extraPaymentsRaw: extraPayments,
    });

    const userIds = [...new Set(cons.map((c) => c.uploadedById).filter((x): x is string => !!x))];
    const users: { id: string; name: string | null; lastName: string | null }[] = userIds.length
      ? await this.ds.query(`SELECT id, name, lastName FROM \`user\` WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds)
      : [];
    const nameOf = (id: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? [u.name, u.lastName].filter(Boolean).join(' ') : null;
    };
    const consKind = (k: PasteBatchKind) => (k === 'aereo' ? 'aereo' : k === 'f2' ? 'f2' : 'master');
    const views: PlanBatchView[] = batches.map((b) => {
      const c = b.consNumber
        ? cons.find((x) => x.consNumber === b.consNumber && x.kind === consKind(b.kind) && x.linkStatus === 'subido')
        : undefined;
      return {
        ...b,
        hvCount: tsvTrackings(b.hvRaw).trackings.size,
        cobrosCount: b.paymentsRaw ? b.paymentsRaw.split('\n').length - 1 : 0,
        uploaded: c?.uploadedAt ? { at: c.uploadedAt, byName: nameOf(c.uploadedById), minutes: c.uploadMinutes, via: c.uploadedVia } : null,
      };
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
    const inBatches = new Set(views.map((v) => v.consNumber).filter(Boolean));
    const announcedOnly = cons
      .filter((c) => !inBatches.has(c.consNumber))
      .map((c) => ({
        consNumber: c.consNumber,
        kind: c.kind,
        announcedCount: c.announcedCount,
        // COD y HV del texto viajan dentro del master cuando el libro trae su hoja.
        insideSheet: (c.kind === 'cod' && sheetRoles.has('cod')) || (c.kind === 'high_value' && sheetRoles.has('hv')) ? (c.kind === 'cod' ? 'COD' : 'HV') : null,
        uploaded: c.linkStatus === 'subido' && c.uploadedAt ? { at: c.uploadedAt, byName: nameOf(c.uploadedById), minutes: c.uploadMinutes } : null,
      }));
    return { ready, reason, batches: views, announcedOnly };
  }

  /** Registra que un lote se mandó y subió desde el pegado. */
  async markPasted(messageId: string, body: { attachmentId: string; kind: PasteBatchKind; consNumber: string; key?: string }, userId: string | null): Promise<void> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('No se encontró ese correo');
    const att = await this.attRepo.findOne({ where: { id: body?.attachmentId, inboxMessageId: messageId } });
    if (!att) throw new BadRequestException('Ese archivo no es de este correo');
    att.pastedAt = new Date();
    if (body.key) att.pastedKeys = [...new Set([...(att.pastedKeys ?? []), String(body.key)])];
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
