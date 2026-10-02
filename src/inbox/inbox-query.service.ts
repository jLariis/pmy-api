import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { InboxMessage, InboxMessageStatus } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxDetection } from '../entities/inbox-detection.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { InboxIngestService } from './inbox-ingest.service';
import { ImapReaderService } from './imap-reader.service';

/** Hermosillo no tiene horario de verano: UTC−7 fijo. */
const TZ_OFFSET_MS = 7 * 3_600_000;
export const localDay = (d: Date): string => new Date(d.getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10);
const dayStartUtc = (day: string): Date => new Date(`${day}T07:00:00.000Z`);

export interface ListFilters {
  status?: string;
  subsidiaryId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Scope = sucursales visibles para el usuario; null = todas (superadmin). */
export type Scope = string[] | null;

/** Vistas de la bandeja, en el lenguaje de la operación. */
export type InboxViewKey = 'falta_confirmar' | 'listos' | 'subidos' | 'todos' | 'ignorado';
const VIEW_KEYS: InboxViewKey[] = ['falta_confirmar', 'listos', 'subidos', 'todos', 'ignorado'];

const UPLOADABLE = "('master','master_aereo','f2','dhl')";
const HAS_GUIDES = `EXISTS (SELECT 1 FROM inbox_attachment ua WHERE ua.inboxMessageId = m.id AND ua.kind IN ${UPLOADABLE})`;
const ALL_UPLOADED = `(EXISTS (SELECT 1 FROM inbox_consolidation uc WHERE uc.inboxMessageId = m.id)
  AND NOT EXISTS (SELECT 1 FROM inbox_consolidation uc WHERE uc.inboxMessageId = m.id AND uc.linkStatus = 'pendiente'))`;
const READY = "m.status IN ('detectado','confirmado')";

const VIEW_WHERE: Record<InboxViewKey, string> = {
  falta_confirmar: "m.status IN ('revision','nuevo')",
  listos: `${READY} AND ${HAS_GUIDES} AND NOT ${ALL_UPLOADED}`,
  subidos: `${READY} AND ${ALL_UPLOADED}`,
  todos: "m.status <> 'ignorado'",
  ignorado: "m.status = 'ignorado'",
};

/** Estado simple de un correo para la lista. */
export type UploadState = 'falta_confirmar' | 'listo' | 'subido' | 'sin_guias' | 'ignorado' | 'error';

@Injectable()
export class InboxQueryService {
  constructor(
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxDetection) private readonly detRepo: Repository<InboxDetection>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly ingest: InboxIngestService,
    private readonly imap: ImapReaderService,
    private readonly ds: DataSource,
  ) {}

  private async subsidiaryNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows: any[] = await this.ds.query(`SELECT id, name FROM subsidiary WHERE id IN (${list.map(() => '?').join(',')})`, list);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows: any[] = await this.ds.query(`SELECT id, name, lastName FROM \`user\` WHERE id IN (${list.map(() => '?').join(',')})`, list);
    return new Map(rows.map((r) => [r.id, [r.name, r.lastName].filter(Boolean).join(' ')]));
  }

  private async latestDetections(ids: string[]): Promise<Map<string, InboxDetection>> {
    if (!ids.length) return new Map();
    const rows = await this.detRepo.find({ where: { inboxMessageId: In(ids) }, order: { createdAt: 'DESC' } });
    const out = new Map<string, InboxDetection>();
    for (const r of rows) if (!out.has(r.inboxMessageId)) out.set(r.inboxMessageId, r);
    return out;
  }

  canSee(m: { subsidiaryId: string | null }, scope: Scope): boolean {
    return scope === null || (!!m.subsidiaryId && scope.includes(m.subsidiaryId));
  }

  async list(f: ListFilters, scope: Scope) {
    const page = Math.max(1, Number(f.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(f.pageSize) || 50));
    const base = () => {
      const qb = this.msgRepo.createQueryBuilder('m');
      if (scope !== null) qb.andWhere(scope.length ? 'm.subsidiaryId IN (:...scope)' : '1 = 0', { scope });
      if (f.subsidiaryId) qb.andWhere('m.subsidiaryId = :sid', { sid: f.subsidiaryId });
      if (f.from) qb.andWhere('m.receivedAt >= :from', { from: dayStartUtc(f.from) });
      if (f.to) qb.andWhere('m.receivedAt < :to', { to: new Date(dayStartUtc(f.to).getTime() + 86_400_000) });
      if (f.q?.trim()) {
        const q = `%${f.q.trim()}%`;
        qb.andWhere(
          new Brackets((b) =>
            b
              .where('m.subject LIKE :q', { q })
              .orWhere('m.fromAddress LIKE :q', { q })
              .orWhere('m.fromName LIKE :q', { q })
              .orWhere('EXISTS (SELECT 1 FROM inbox_consolidation c WHERE c.inboxMessageId = m.id AND c.consNumber LIKE :q)', { q }),
          ),
        );
      }
      return qb;
    };

    const counts = {} as Record<InboxViewKey, number>;
    await Promise.all(VIEW_KEYS.map(async (v) => (counts[v] = await base().andWhere(VIEW_WHERE[v]).getCount())));

    const qb = base();
    const view: InboxViewKey = VIEW_KEYS.includes(f.status as InboxViewKey) ? (f.status as InboxViewKey) : 'falta_confirmar';
    qb.andWhere(VIEW_WHERE[view]);
    qb.select(['m.id', 'm.receivedAt', 'm.fromAddress', 'm.fromName', 'm.subject', 'm.status', 'm.subsidiaryId', 'm.ignoreReason', 'm.errorMessage'])
      .orderBy('m.receivedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    const ids = rows.map((r) => r.id);
    const [atts, cons, dets, subs] = await Promise.all([
      ids.length ? this.attRepo.find({ where: { inboxMessageId: In(ids) }, select: ['id', 'inboxMessageId', 'filename', 'kind'] }) : [],
      ids.length ? this.consRepo.find({ where: { inboxMessageId: In(ids) } }) : [],
      this.latestDetections(ids),
      this.subsidiaryNames(rows.map((r) => r.subsidiaryId)),
    ]);
    const items = rows.map((m) => {
      const d = dets.get(m.id);
      const mc = cons.filter((c) => c.inboxMessageId === m.id);
      const ma = atts.filter((a) => a.inboxMessageId === m.id);
      const hasGuides = ma.some((a) => ['master', 'master_aereo', 'f2', 'dhl'].includes(a.kind));
      const uploadState: UploadState =
        m.status === 'ignorado' ? 'ignorado'
        : m.status === 'error' ? 'error'
        : m.status === 'revision' || m.status === 'nuevo' ? 'falta_confirmar'
        : !hasGuides ? 'sin_guias'
        : mc.length && mc.every((c) => c.linkStatus !== 'pendiente') ? 'subido'
        : 'listo';
      return {
        uploadState,
        id: m.id,
        receivedAt: m.receivedAt,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        subject: m.subject,
        status: m.status,
        subsidiaryId: m.subsidiaryId,
        subsidiaryName: m.subsidiaryId ? subs.get(m.subsidiaryId) ?? null : null,
        confidence: d ? Number(d.confidence) : null,
        autoSafe: d?.autoSafe ?? false,
        reason: m.status === 'ignorado' ? m.ignoreReason : m.status === 'error' ? m.errorMessage : d?.reason ?? null,
        attachments: atts.filter((a) => a.inboxMessageId === m.id).map((a) => ({ id: a.id, filename: a.filename, kind: a.kind })),
        consolidations: mc.map((c) => ({ consNumber: c.consNumber, kind: c.kind, announcedCount: c.announcedCount, linkStatus: c.linkStatus, uploadMinutes: c.uploadMinutes })),
        cobrosCount: mc.reduce((s, c) => s + (c.cobros?.length ?? 0), 0),
      };
    });
    return { items, total, page, pageSize, counts };
  }

  async detail(id: string, scope: Scope) {
    const m = await this.msgRepo.findOne({ where: { id } });
    if (!m || !this.canSee(m, scope)) throw new NotFoundException('No se encontró ese correo');
    const [atts, cons, dets] = await Promise.all([
      this.attRepo.find({ where: { inboxMessageId: id } }),
      this.consRepo.find({ where: { inboxMessageId: id } }),
      this.detRepo.find({ where: { inboxMessageId: id }, order: { createdAt: 'DESC' }, take: 1 }),
    ]);
    const d = dets[0] ?? null;
    const subIds = [m.subsidiaryId, d?.subsidiaryId ?? null, d?.runnerUp?.subsidiaryId ?? null, ...(d?.signals ?? []).map((s) => s.subsidiaryId)];
    const [subs, users] = await Promise.all([this.subsidiaryNames(subIds), this.userNames([m.confirmedById, ...cons.map((c) => c.uploadedById)])]);
    return {
      message: {
        ...m,
        subsidiaryName: m.subsidiaryId ? subs.get(m.subsidiaryId) ?? null : null,
        confirmedByName: m.confirmedById ? users.get(m.confirmedById) ?? null : null,
      },
      attachments: atts.map((a) => ({ ...a, storagePath: undefined })),
      detection: d && {
        ...d,
        confidence: Number(d.confidence),
        subsidiaryName: d.subsidiaryId ? subs.get(d.subsidiaryId) ?? null : null,
        runnerUpName: d.runnerUp ? subs.get(d.runnerUp.subsidiaryId) ?? null : null,
        signals: d.signals.map((s) => ({ ...s, subsidiaryName: subs.get(s.subsidiaryId) ?? null })),
      },
      consolidations: cons.map((c) => ({ ...c, uploadedByName: c.uploadedById ? users.get(c.uploadedById) ?? null : null })),
    };
  }

  async board(f: { from?: string; to?: string; subsidiaryId?: string }, scope: Scope) {
    const today = localDay(new Date());
    const from = f.from || today;
    const to = f.to || today;
    const qb = this.consRepo
      .createQueryBuilder('c')
      .where('c.receivedAt >= :from AND c.receivedAt < :to', { from: dayStartUtc(from), to: new Date(dayStartUtc(to).getTime() + 86_400_000) })
      .andWhere("c.linkStatus <> 'no_aplica'");
    if (scope !== null) qb.andWhere(scope.length ? 'c.subsidiaryId IN (:...scope)' : '1 = 0', { scope });
    if (f.subsidiaryId) qb.andWhere('c.subsidiaryId = :sid', { sid: f.subsidiaryId });
    const rows = await qb.orderBy('c.receivedAt', 'ASC').getMany();
    const [subs, users] = await Promise.all([this.subsidiaryNames(rows.map((r) => r.subsidiaryId)), this.userNames(rows.map((r) => r.uploadedById))]);
    const now = Date.now();

    type Group = { subsidiaryId: string | null; subsidiaryName: string; day: string; items: any[] };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const day = localDay(r.receivedAt);
      const key = `${r.subsidiaryId ?? '-'}|${day}`;
      const g = groups.get(key) ?? { subsidiaryId: r.subsidiaryId, subsidiaryName: r.subsidiaryId ? subs.get(r.subsidiaryId) ?? 'Sucursal' : 'Sin sucursal', day, items: [] };
      g.items.push({
        id: r.id,
        inboxMessageId: r.inboxMessageId,
        consNumber: r.consNumber,
        kind: r.kind,
        announcedCount: r.announcedCount,
        receivedAt: r.receivedAt,
        uploadedAt: r.uploadedAt,
        uploadedByName: r.uploadedById ? users.get(r.uploadedById) ?? null : null,
        uploadedVia: r.uploadedVia,
        linkStatus: r.linkStatus,
        minutes: r.linkStatus === 'subido' ? r.uploadMinutes : Math.max(0, Math.round((now - r.receivedAt.getTime()) / 60_000)),
      });
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => {
        const up = g.items.filter((i) => i.linkStatus === 'subido');
        const pend = g.items.filter((i) => i.linkStatus === 'pendiente');
        return {
          subsidiaryId: g.subsidiaryId,
          subsidiaryName: g.subsidiaryName,
          day: g.day,
          received: g.items.length,
          uploaded: up.length,
          pending: pend.length,
          avgMinutes: up.length ? Math.round(up.reduce((s, i) => s + (i.minutes ?? 0), 0) / up.length) : null,
          worstMinutes: g.items.length ? Math.max(...g.items.map((i) => i.minutes ?? 0)) : null,
          items: g.items,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day) || b.pending - a.pending || a.subsidiaryName.localeCompare(b.subsidiaryName));
  }

  async status() {
    const s = await this.ingest.getState();
    const since = dayStartUtc(localDay(new Date()));
    const rows: any[] = await this.ds.query('SELECT status, COUNT(*) AS n FROM inbox_message WHERE createdAt >= ? GROUP BY status', [since]);
    const today: Record<string, number> = {};
    rows.forEach((r) => (today[r.status] = Number(r.n)));
    const configured = this.imap.isConfigured();
    const active = configured && this.ingest.envEnabled() && s.enabled;
    const stale = !s.lastOkAt || Date.now() - new Date(s.lastOkAt).getTime() > 30 * 60_000;
    const health = !configured ? 'sin_configurar' : !active ? 'pausado' : stale ? 'atrasado' : 'ok';
    return {
      mailbox: s.mailbox,
      configured,
      serverEnabled: this.ingest.envEnabled(),
      enabled: s.enabled,
      health,
      lastRunAt: s.lastRunAt,
      lastOkAt: s.lastOkAt,
      lastError: s.lastError,
      lastUid: s.lastUid,
      allowedDomains: (process.env.INBOX_ALLOWED_DOMAINS || 'fedex.com').split(',').map((d) => d.trim()),
      today,
    };
  }
}
