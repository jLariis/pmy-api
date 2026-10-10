import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { InboxMessage, InboxMessageStatus } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxDetection } from '../entities/inbox-detection.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { InboxIngestService } from './inbox-ingest.service';
import { ImapReaderService } from './imap-reader.service';
import { RouteDay, routeOf, summarizeRoutes } from './route-cons.util';
import { InboxCarrier, inboxDomains } from './mail-analysis';
import { promises as fs } from 'fs';
import { join } from 'path';
import { isSpreadsheet } from './attachment-classify.util';
import { dhlDueDatesFromWorkbook, dhlPasteText } from './dhl-paste.util';

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
  /** Paquetería: 'fedex' (por defecto) o 'dhl', según el dominio del remitente. */
  carrier?: InboxCarrier;
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
// COALESCE: uploadCoverage vacío (aún no se revisa contra el sistema) = NO subido. Sin él la
// comparación da NULL, NOT(NULL) también, y el correo no salía en ninguna vista salvo "Todos".
const UPLOADED = `(COALESCE(m.uploadCoverage, '') = 'completo' OR ${ALL_UPLOADED})`;

const VIEW_WHERE: Record<InboxViewKey, string> = {
  // Lo que ya está en el sistema (por guías o por número) es "Subido" aunque nadie haya confirmado la sucursal.
  falta_confirmar: `m.status IN ('revision','nuevo') AND NOT ${UPLOADED}`,
  listos: `${READY} AND ${HAS_GUIDES} AND NOT ${UPLOADED}`,
  subidos: `m.status NOT IN ('ignorado','error') AND ${UPLOADED}`,
  todos: "m.status <> 'ignorado'",
  ignorado: "m.status = 'ignorado'",
};

/** Estado simple de un correo para la lista. */
export type UploadState = 'falta_confirmar' | 'listo' | 'subido' | 'parcial' | 'sin_guias' | 'ignorado' | 'error';

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
    const carrier: InboxCarrier = f.carrier === 'dhl' ? 'dhl' : 'fedex';
    const base = (forCarrier: InboxCarrier = carrier, withDates = true) => {
      const qb = this.msgRepo.createQueryBuilder('m');
      qb.andWhere('m.carrier = :carrier', { carrier: forCarrier });
      if (scope !== null) qb.andWhere(scope.length ? 'm.subsidiaryId IN (:...scope)' : '1 = 0', { scope });
      if (f.subsidiaryId) qb.andWhere('m.subsidiaryId = :sid', { sid: f.subsidiaryId });
      if (withDates && f.from) qb.andWhere('m.receivedAt >= :from', { from: dayStartUtc(f.from) });
      if (withDates && f.to) qb.andWhere('m.receivedAt < :to', { to: new Date(dayStartUtc(f.to).getTime() + 86_400_000) });
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
    // Pendientes por paquetería (falta confirmar + listos) para las pestañas FedEx / DHL.
    const pendingWhere = `(${VIEW_WHERE.falta_confirmar}) OR (${VIEW_WHERE.listos})`;
    const carrierCounts = {} as Record<InboxCarrier, number>;
    await Promise.all((['fedex', 'dhl'] as InboxCarrier[]).map(async (c) => (carrierCounts[c] = await base(c).andWhere(`(${pendingWhere})`).getCount())));

    const qb = base();
    const view: InboxViewKey = VIEW_KEYS.includes(f.status as InboxViewKey) ? (f.status as InboxViewKey) : 'falta_confirmar';
    qb.andWhere(VIEW_WHERE[view]);
    qb.select(['m.id', 'm.carrier', 'm.receivedAt', 'm.fromAddress', 'm.fromName', 'm.subject', 'm.status', 'm.subsidiaryId', 'm.ignoreReason', 'm.errorMessage', 'm.uploadCoverage'])
      .orderBy('m.receivedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [rows, total] = await qb.getManyAndCount();

    // Correos de esta vista que quedan FUERA de las fechas elegidas (p. ej. DHL viejos): para el
    // aviso "Hay N correos fuera de estas fechas · Ver todos" (lleva al más antiguo).
    let outsideDates: { count: number; oldestDay: string } | null = null;
    if (f.from || f.to) {
      const all = base(carrier, false).andWhere(VIEW_WHERE[view]);
      const agg = await all.select('COUNT(*)', 'n').addSelect('MIN(m.receivedAt)', 'oldest').getRawOne<{ n: string; oldest: Date | null }>();
      const count = Number(agg?.n ?? 0) - Number(counts[view] ?? 0);
      if (count > 0 && agg?.oldest) outsideDates = { count, oldestDay: localDay(new Date(agg.oldest)) };
    }
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
        : m.uploadCoverage === 'completo' || (mc.length > 0 && mc.every((c) => c.linkStatus !== 'pendiente')) ? 'subido'
        : m.uploadCoverage === 'parcial' ? 'parcial'
        : m.status === 'revision' || m.status === 'nuevo' ? 'falta_confirmar'
        : !hasGuides ? 'sin_guias'
        : 'listo';
      return {
        uploadState,
        carrier: m.carrier,
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
    return { items, total, page, pageSize, counts, carrier, carrierCounts, outsideDates };
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
    const { textBody, ...msgFields } = m;
    return {
      dhl: m.carrier === 'dhl' ? await this.dhlImport(textBody, atts) : null,
      message: {
        ...msgFields,
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

  /**
   * Lo que necesita "Importar DHL" desde la Bandeja: el cuerpo a pegar (bloques "AWB :") y los
   * vencimientos del Excel DHL de 3 hojas (por guía y por JD). La hoja simple no trae vencimiento.
   */
  private async dhlImport(textBody: string | null, atts: InboxAttachment[]) {
    const dueDates: Record<string, string> = {};
    let excelAttachmentId: string | null = null; // el Excel DHL de 3 hojas (se abre directo si el cuerpo no trae guías)
    for (const a of atts.filter((x) => isSpreadsheet(x.filename))) {
      try {
        const found = dhlDueDatesFromWorkbook(await fs.readFile(join(process.cwd(), a.storagePath)));
        if (Object.keys(found).length && !excelAttachmentId) excelAttachmentId = a.id;
        Object.assign(dueDates, found);
      } catch {
        /* archivo no disponible en disco: sin vencimientos de ese adjunto */
      }
    }
    return { pasteText: dhlPasteText(textBody), dueDates, excelAttachmentId };
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

  /** Rutas locales: por número de ruta, los días que llegó por correo contra lo que se subió (por guías). */
  async routes(f: { from?: string; to?: string; subsidiaryId?: string }, scope: Scope) {
    const today = localDay(new Date());
    const to = f.to || today;
    const from = f.from || localDay(new Date(dayStartUtc(to).getTime() - 13 * 86_400_000));
    const qb = this.attRepo
      .createQueryBuilder('a')
      .innerJoin(InboxMessage, 'm', 'm.id = a.inboxMessageId')
      .select(['a.filename AS filename', 'a.systemMatch AS systemMatch', 'm.receivedAt AS receivedAt'])
      .where('m.receivedAt >= :from AND m.receivedAt < :to', { from: dayStartUtc(from), to: new Date(dayStartUtc(to).getTime() + 86_400_000) })
      .andWhere("m.status <> 'ignorado'")
      .andWhere('a.systemMatch IS NOT NULL');
    if (scope !== null) qb.andWhere(scope.length ? 'm.subsidiaryId IN (:...scope)' : '1 = 0', { scope });
    if (f.subsidiaryId) qb.andWhere('m.subsidiaryId = :sid', { sid: f.subsidiaryId });
    const raw: any[] = await qb.getRawMany();
    const days: RouteDay[] = [];
    for (const r of raw) {
      const sm = (typeof r.systemMatch === 'string' ? JSON.parse(r.systemMatch) : r.systemMatch) ?? {};
      for (const [sheet, m] of Object.entries<any>(sm)) {
        const route = routeOf(sheet === '_' ? r.filename : sheet) ?? routeOf(r.filename);
        if (!route || !m?.total) continue;
        const top = [...(m.groups ?? [])].sort((a: any, b: any) => b.count - a.count)[0] ?? null;
        days.push({
          route,
          day: localDay(new Date(r.receivedAt)),
          total: m.total,
          found: m.found,
          complete: !!m.complete,
          type: top?.type ?? null,
          subsidiaryName: top?.subsidiaryName ?? null,
          consNumber: top?.consNumber ?? null,
        });
      }
    }
    return { from, to, routes: summarizeRoutes(days) };
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
      dhlDomains: inboxDomains((k) => process.env[k]).dhl,
      today,
    };
  }
}
