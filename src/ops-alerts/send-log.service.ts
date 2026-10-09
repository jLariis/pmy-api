import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CorreoSendLog, SendChannel, SendOrigin } from '../entities/correo-send-log.entity';
import { WhatsappGatewayService } from '../whatsapp-gateway/whatsapp-gateway.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface SendContext {
  origin: SendOrigin;
  sentById: string | null;
  sentByName: string | null;
  subsidiaryId: string | null;
  consNumber: string | null;
  inboxMessageId?: string | null;
}

export interface SendResult {
  channel: SendChannel;
  recipientName: string | null;
  status: 'enviado' | 'fallido' | 'en_cola';
  error?: string | null;
}

/**
 * Manda (WhatsApp / campana / correo) y deja una fila por destinatario en el historial de
 * Correos. Si guardar el historial falla, el envío no se detiene.
 */
@Injectable()
export class SendLogService {
  private readonly logger = new Logger(SendLogService.name);

  constructor(
    @InjectRepository(CorreoSendLog) private readonly repo: Repository<CorreoSendLog>,
    private readonly whatsapp: WhatsappGatewayService,
    private readonly notifications: NotificationsService,
    private readonly ds: DataSource,
  ) {}

  private async save(rows: Partial<CorreoSendLog>[]) {
    if (!rows.length) return;
    try {
      await this.repo.insert(rows);
    } catch (e: any) {
      this.logger.warn(`[correos] no se pudo guardar el historial de envíos: ${e?.message ?? e}`);
    }
  }

  /** WhatsApp a un grupo (`@g.us`) o número; registra si salió o el error. */
  async whatsappTo(to: { id: string; name?: string | null }, text: string, ctx: SendContext, title: string | null = null): Promise<SendResult> {
    let status: SendResult['status'] = 'enviado';
    let error: string | null = null;
    try {
      await this.whatsapp.sendText(to.id, text);
    } catch (e: any) {
      status = 'fallido';
      error = String(e?.message ?? e).slice(0, 500);
      this.logger.warn(`[correos] WhatsApp a ${to.name ?? to.id}: ${error}`);
    }
    await this.save([{ ...this.base(ctx), channel: 'whatsapp', recipientType: to.id.endsWith('@g.us') ? 'grupo' : 'numero', recipientId: to.id, recipientName: to.name ?? to.id, title, body: text, status, error }]);
    return { channel: 'whatsapp', recipientName: to.name ?? to.id, status, error };
  }

  /** Campana (y correo si `email`) a usuarios; una fila por usuario y canal. */
  async notifyUsers(
    userIds: string[],
    event: { type: string; title: string; body: string; severity?: 'info' | 'warning' | 'error'; link?: string; entityId?: string },
    ctx: SendContext,
    email = false,
  ): Promise<SendResult[]> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return [];
    await this.notifications.emit({
      ...event,
      category: 'operacion',
      audience: { userIds: ids },
      channels: email ? ['bell', 'email'] : ['bell'],
      subsidiaryId: ctx.subsidiaryId ?? undefined,
      actor: ctx.sentById ? { id: ctx.sentById, name: ctx.sentByName ?? undefined } : undefined,
      excludeActor: false,
    } as any);
    const users: any[] = await this.ds.query(
      `SELECT id, email, TRIM(CONCAT(COALESCE(name, ''), ' ', COALESCE(lastName, ''))) AS name FROM \`user\` WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    const rows: Partial<CorreoSendLog>[] = [];
    const out: SendResult[] = [];
    for (const u of users) {
      const name = u.name || u.email || u.id;
      rows.push({ ...this.base(ctx), channel: 'campana', recipientType: 'usuario', recipientId: u.id, recipientName: name, title: event.title, body: event.body, status: 'enviado', error: null });
      out.push({ channel: 'campana', recipientName: name, status: 'enviado' });
      if (email) {
        const st = u.email ? 'en_cola' : 'fallido';
        rows.push({ ...this.base(ctx), channel: 'correo', recipientType: 'usuario', recipientId: u.id, recipientName: u.email ? `${name} <${u.email}>` : name, title: event.title, body: event.body, status: st, error: u.email ? null : 'El usuario no tiene correo' });
        out.push({ channel: 'correo', recipientName: name, status: st });
      }
    }
    await this.save(rows);
    return out;
  }

  private base(ctx: SendContext): Partial<CorreoSendLog> {
    return {
      origin: ctx.origin,
      sentById: ctx.sentById,
      sentByName: ctx.sentByName ?? (ctx.sentById ? null : 'Sistema'),
      subsidiaryId: ctx.subsidiaryId,
      consNumber: ctx.consNumber,
      inboxMessageId: ctx.inboxMessageId ?? null,
    };
  }

  /** Historial con filtros (fechas YYYY-MM-DD en hora de Hermosillo). */
  async list(
    f: { from?: string; to?: string; subsidiaryId?: string; channel?: string; origin?: string; q?: string; page?: number; pageSize?: number },
    scope: string[] | null,
  ) {
    const page = Math.max(1, Number(f.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(f.pageSize) || 50));
    const qb = this.repo.createQueryBuilder('l');
    if (f.from) qb.andWhere('l.createdAt >= :from', { from: new Date(`${f.from}T07:00:00.000Z`) });
    if (f.to) qb.andWhere('l.createdAt < :to', { to: new Date(new Date(`${f.to}T07:00:00.000Z`).getTime() + 86_400_000) });
    if (f.subsidiaryId) qb.andWhere('l.subsidiaryId = :sid', { sid: f.subsidiaryId });
    if (f.channel) qb.andWhere('l.channel = :ch', { ch: f.channel });
    if (f.origin) qb.andWhere('l.origin = :or', { or: f.origin });
    if (f.q?.trim()) qb.andWhere('(l.consNumber LIKE :q OR l.recipientName LIKE :q OR l.sentByName LIKE :q OR l.title LIKE :q)', { q: `%${f.q.trim()}%` });
    if (scope !== null) qb.andWhere(scope.length ? 'l.subsidiaryId IN (:...scope)' : '1 = 0', { scope });
    const [items, total] = await qb.orderBy('l.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    const subIds = [...new Set(items.map((i) => i.subsidiaryId).filter((x): x is string => !!x))];
    const subs: any[] = subIds.length ? await this.ds.query(`SELECT id, name FROM subsidiary WHERE id IN (${subIds.map(() => '?').join(',')})`, subIds) : [];
    const subName = new Map(subs.map((s) => [s.id, s.name]));
    return { items: items.map((i) => ({ ...i, subsidiaryName: i.subsidiaryId ? subName.get(i.subsidiaryId) ?? null : null })), total, page, pageSize };
  }
}
