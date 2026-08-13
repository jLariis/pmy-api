import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportZoneAuthorizer } from 'src/entities/support-zone-authorizer.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { User } from 'src/entities/user.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { canApprove, isSuperRole } from './approval-logic';

export type ApprovalActor = { userId: string; name?: string; lastName?: string; role?: string };

/**
 * Gobernanza de soporte: autorizadores por zona y flujo de aprobación de tickets.
 * La zona de un ticket se deriva de `subsidiary.zoneId`. Es la fuente de verdad de
 * permisos: los endpoints solo delegan aquí.
 */
@Injectable()
export class SupportApprovalService {
  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportZoneAuthorizer) private readonly authRepo: Repository<SupportZoneAuthorizer>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifier: NotificationsService,
  ) {}

  private actorName(a: ApprovalActor): string {
    return [a.name, a.lastName].filter(Boolean).join(' ') || a.userId;
  }

  /** Zona (id) de un ticket, vía su sucursal. `null` si no se puede resolver. */
  async zoneIdForTicket(t: Pick<SupportTicket, 'subsidiaryId'>): Promise<string | null> {
    if (!t.subsidiaryId) return null;
    try {
      const s = await this.subsidiaryRepo.findOne({ where: { id: t.subsidiaryId }, select: ['id', 'zoneId'] as any });
      return (s as any)?.zoneId ?? null;
    } catch {
      return null;
    }
  }

  /** Mapa subsidiaryId→zoneId para un lote (evita N+1 al serializar listas). */
  async zoneMap(subsidiaryIds: (string | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [...new Set(subsidiaryIds.filter(Boolean) as string[])];
    const map = new Map<string, string>();
    if (!ids.length) return map;
    try {
      const rows = await this.subsidiaryRepo.find({ where: { id: In(ids) }, select: ['id', 'zoneId'] as any });
      for (const r of rows as any[]) if (r.zoneId) map.set(r.id, r.zoneId);
    } catch {
      /* degrada a vacío */
    }
    return map;
  }

  async isAuthorizerForZone(userId: string, zoneId: string | null): Promise<boolean> {
    if (!zoneId) return false;
    return (await this.authRepo.count({ where: { zoneId, userId } })) > 0;
  }

  /** Zonas que el usuario puede autorizar (para pintar botones en el front). */
  async myZones(userId: string): Promise<string[]> {
    const rows = await this.authRepo.find({ where: { userId }, select: ['zoneId'] });
    return rows.map((r) => r.zoneId);
  }

  // -------------------------------------------------------------------------
  // Config CRUD (superadmin)
  // -------------------------------------------------------------------------

  async listAuthorizers(zoneId?: string): Promise<SupportZoneAuthorizer[]> {
    return this.authRepo.find({ where: zoneId ? { zoneId } : {}, order: { zoneId: 'ASC', createdAt: 'ASC' } });
  }

  async addAuthorizer(zoneId: string, userId: string): Promise<SupportZoneAuthorizer> {
    if (!zoneId || !userId) throw new BadRequestException('zoneId y userId son requeridos');
    const existing = await this.authRepo.findOne({ where: { zoneId, userId } });
    if (existing) return existing;
    const u = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'name', 'email'] as any });
    return this.authRepo.save(this.authRepo.create({
      zoneId,
      userId,
      userName: (u as any)?.name ?? null,
      userEmail: (u as any)?.email ?? null,
    }));
  }

  async removeAuthorizer(id: string): Promise<{ ok: boolean }> {
    await this.authRepo.delete({ id });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Flujo de aprobación
  // -------------------------------------------------------------------------

  /** Notifica a los autorizadores de la zona que hay un ticket por aprobar. */
  async notifyPendingApproval(t: SupportTicket): Promise<void> {
    const zoneId = await this.zoneIdForTicket(t);
    const authorizers = zoneId ? await this.authRepo.find({ where: { zoneId } }) : [];
    const userIds = authorizers.map((a) => a.userId);
    await this.notifier.emit({
      type: 'ticket.por_aprobar',
      audience: userIds.length ? { userIds } : { role: 'superadmin' },
      title: `Aprobación requerida: ${t.folio}`,
      body: t.titulo,
      link: `/support/admin?ticket=${t.id}`,
      entityId: t.id,
      subsidiaryId: t.subsidiaryId ?? undefined,
    });
  }

  private async loadForDecision(id: string, actor: ApprovalActor): Promise<SupportTicket> {
    const t = await this.ticketRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.approvalStatus !== 'pendiente') {
      throw new BadRequestException('El ticket no está pendiente de aprobación.');
    }
    const zoneId = await this.zoneIdForTicket(t);
    const allowed = canApprove(isSuperRole(actor.role), await this.isAuthorizerForZone(actor.userId, zoneId));
    if (!allowed) throw new ForbiddenException('No tienes permiso para aprobar/rechazar en esta zona.');
    return t;
  }

  async approve(id: string, actor: ApprovalActor): Promise<void> {
    const t = await this.loadForDecision(id, actor);
    await this.ticketRepo.update({ id }, {
      approvalStatus: 'aprobado',
      approvedById: actor.userId,
      approvedByName: this.actorName(actor),
      approvalAt: new Date(),
      approvalNote: null,
    });
    await this.notifier.emit({
      type: 'ticket.aprobado',
      audience: { userId: t.requesterId },
      title: `Tu ticket ${t.folio} fue aprobado`,
      body: t.titulo,
      link: `/support/my-tickets?ticket=${id}`,
      entityId: id,
      actor: { id: actor.userId, name: this.actorName(actor) },
    });
  }

  async reject(id: string, actor: ApprovalActor, note: string): Promise<void> {
    const t = await this.loadForDecision(id, actor);
    await this.ticketRepo.update({ id }, {
      approvalStatus: 'rechazado',
      estado: 'rechazado',
      resolvedAt: new Date(),
      approvedById: actor.userId,
      approvedByName: this.actorName(actor),
      approvalAt: new Date(),
      approvalNote: note?.trim() || null,
    });
    await this.notifier.emit({
      type: 'ticket.rechazado_aprobacion',
      audience: { userId: t.requesterId },
      title: `Tu ticket ${t.folio} fue rechazado`,
      body: note?.trim() || t.titulo,
      link: `/support/my-tickets?ticket=${id}`,
      entityId: id,
      actor: { id: actor.userId, name: this.actorName(actor) },
    });
  }
}
