import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AuditLog } from 'src/entities/audit-log.entity';
import { NotificationRead } from 'src/entities/notification-read.entity';
import { Notification } from 'src/entities/notification.entity';
import { User } from 'src/entities/user.entity';
import { parseDevice, geoFromIp } from 'src/audit/client-info.util';
import { NotificationEvent, Audience } from './notification.types';
import { resolvePresentation } from './notification-catalog';
import { NotificationDispatchService } from './notification-dispatch.service';

const SUPER_ROLES = ['superadmin', 'superamin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mapea la ruta del evento a un tipo de notificación legible. */
const ROUTES: { match: (p: string) => boolean; module: string; verb: string }[] = [
  { match: (p) => p === '/consolidated', module: 'consolidados', verb: 'registró un consolidado' },
  { match: (p) => p === '/unloadings', module: 'desembarques', verb: 'registró un desembarque' },
  { match: (p) => p === '/package-dispatchs', module: 'salidas_ruta', verb: 'registró una salida a ruta' },
  { match: (p) => p === '/devolutions', module: 'devoluciones', verb: 'registró una devolución' },
  { match: (p) => p === '/collections', module: 'recolecciones', verb: 'registró una recolección' },
  { match: (p) => p === '/inventories', module: 'inventarios', verb: 'registró un inventario' },
  { match: (p) => p === '/route-closure', module: 'cierre_ruta', verb: 'registró un cierre de ruta' },
  { match: (p) => p === '/transfers' || p === '/package-transfers', module: 'traslados', verb: 'registró un traslado' },
  { match: (p) => p.startsWith('/warehouse'), module: 'bodega', verb: 'registró un movimiento de bodega' },
  { match: (p) => p === '/dhl-webhook', module: 'dhl', verb: 'actualización DHL' },
];

export interface NotificationItem {
  id: string;
  createdAt: Date;
  module: string;
  actor: string;
  actorEmail?: string;
  message: string;
  entityId?: string;
  subsidiaryId?: string;
  ip?: string;
  device?: string;
  location?: string;
  read: boolean;
  kind: 'operation' | 'session';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(NotificationRead) private readonly readRepo: Repository<NotificationRead>,
    @InjectRepository(Notification) private readonly notifRepo: Repository<Notification>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  private normalizePath(p?: string): string {
    if (!p) return '';
    return p.split('?')[0].replace(/^\/api/, '').replace(/\/+$/, '');
  }

  private actorName(row: AuditLog): string {
    return row.userName || row.userEmail || 'Un usuario';
  }

  /** Convierte una fila de auditoría en notificación, o null si no aplica. */
  private toNotification(row: AuditLog, isSuper: boolean): NotificationItem | null {
    const actor = this.actorName(row);
    const idLabel = row.entityId && !UUID_RE.test(row.entityId) ? ` (${row.entityId})` : '';

    // Inicios / cierres de sesión: SOLO para superadmin.
    if (row.module === 'auth' && (row.action === 'login' || row.action === 'logout')) {
      if (!isSuper) return null;
      const loc = [row.geoCity, row.geoRegion, row.geoCountry].filter(Boolean).join(', ') || geoFromIp(row.ip) || undefined;
      return {
        id: row.id, createdAt: row.createdAt, module: 'auth', actor, actorEmail: row.userEmail,
        message: `${actor} ${row.action === 'login' ? 'inició sesión' : 'cerró sesión'}`,
        subsidiaryId: row.subsidiaryId, ip: row.publicIp || row.ip,
        device: row.device || parseDevice(row.userAgent), location: loc,
        read: false, kind: 'session',
      };
    }

    // Operaciones: solo POST exitosos cuyo path coincide con una ruta conocida.
    if (row.method !== 'POST') return null;
    const path = this.normalizePath(row.path);
    const route = ROUTES.find((r) => r.match(path));
    if (!route) return null;

    // Usa la descripción rica del catálogo de auditoría cuando exista
    // ("Creó salida a ruta R-1234 · 18 paquetes"); si no, el verbo genérico.
    const message = row.description
      ? `${actor}: ${row.description}`
      : `${actor} ${route.verb}${idLabel}`;

    return {
      id: row.id, createdAt: row.createdAt, module: route.module, actor, actorEmail: row.userEmail,
      message,
      entityId: row.entityId, subsidiaryId: row.subsidiaryId, ip: row.ip, read: false, kind: 'operation',
    };
  }

  private async getLastReadAt(userId: string): Promise<Date | null> {
    try {
      const row = await this.readRepo.findOne({ where: { userId } });
      return row?.lastReadAt ?? null;
    } catch {
      return null;
    }
  }

  async getFeed(user: any, limit = 30) {
    try {
      const role = (user?.role || '').toLowerCase();
      const isSuper = SUPER_ROLES.includes(role);
      const subId = user?.subsidiary?.id ?? user?.subsidiaryId;

      const qb = this.auditRepo
        .createQueryBuilder('a')
        .where('a.result = :ok', { ok: 'success' })
        .orderBy('a.createdAt', 'DESC')
        .limit(300);

      if (!isSuper) {
        // Usuario normal: solo su sucursal (y sin eventos de sesión, filtrados en toNotification).
        qb.andWhere('a.subsidiaryId = :subId', { subId: subId ?? '___none___' });
      }

      const rows = await qb.getMany();
      const lastReadAt = await this.getLastReadAt(user.userId);

      const all: NotificationItem[] = [];
      for (const r of rows) {
        const n = this.toNotification(r, isSuper);
        if (!n) continue;
        n.read = lastReadAt ? new Date(r.createdAt) <= lastReadAt : false;
        all.push(n);
      }

      const unreadCount = all.filter((n) => !n.read).length;
      return { items: all.slice(0, limit), unreadCount, lastReadAt };
    } catch (e) {
      this.logger.warn(`notifications.getFeed degradado: ${e.message}`);
      return { items: [], unreadCount: 0, lastReadAt: null };
    }
  }

  async markAllRead(userId: string) {
    try {
      await this.readRepo.upsert({ userId, lastReadAt: new Date() }, ['userId']);
      return { ok: true };
    } catch (e) {
      this.logger.warn(`notifications.markAllRead degradado: ${e.message}`);
      return { ok: false };
    }
  }

  /** Traduce una audiencia a la lista de userIds destinatarios. */
  async resolveAudience(audience: Audience, excludeActorId?: string): Promise<string[]> {
    let ids: string[] = [];
    if ('userId' in audience) ids = [audience.userId];
    else if ('userIds' in audience) ids = audience.userIds;
    else if ('global' in audience) {
      const users = await this.userRepo.find({ where: { active: true }, select: ['id'] });
      ids = users.map((u) => u.id);
    } else if ('role' in audience) {
      const users = await this.userRepo.find({ where: { active: true, role: audience.role as any }, select: ['id'] });
      ids = users.map((u) => u.id);
    } else {
      // subsidiaryId (+ roles opcional)
      const where: any = { active: true, subsidiary: { id: audience.subsidiaryId } };
      if (audience.roles?.length) where.role = In(audience.roles as any[]);
      const users = await this.userRepo.find({ where, select: ['id'] });
      ids = users.map((u) => u.id);
    }
    const set = new Set(ids.filter(Boolean));
    if (excludeActorId) set.delete(excludeActorId);
    return [...set];
  }

  /**
   * Emite un evento: resuelve audiencia, persiste una fila por destinatario y
   * despacha canales laterales best-effort. NUNCA lanza al llamador.
   */
  async emit(event: NotificationEvent): Promise<void> {
    try {
      const p = resolvePresentation(event.type, {
        category: event.category, icon: event.icon, severity: event.severity, channels: event.channels,
      });
      const excludeActor = event.excludeActor ?? true;
      const recipients = await this.resolveAudience(event.audience, excludeActor ? event.actor?.id : undefined);
      if (recipients.length === 0) return;

      const now = new Date();
      const rows = recipients.map((recipientId) =>
        this.notifRepo.create({
          recipientId,
          type: event.type,
          category: p.category,
          title: event.title ?? '',
          body: event.body ?? null,
          icon: p.icon,
          severity: p.severity,
          link: event.link ?? null,
          entityId: event.entityId ?? null,
          subsidiaryId: event.subsidiaryId ?? null,
          actorId: event.actor?.id ?? null,
          actorName: event.actor?.name ?? null,
          read: false,
          readAt: null,
          createdAt: now,
        }),
      );
      await this.notifRepo.save(rows);

      // Canales laterales (Task 4). Best-effort, no bloquea.
      void this.dispatch.deliver(event, recipients, p.channels).catch((e) =>
        this.logger.warn(`dispatch falló: ${e?.message}`),
      );
    } catch (e: any) {
      this.logger.warn(`emit degradado (${event?.type}): ${e?.message}`);
    }
  }
}
