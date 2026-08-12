import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { User } from 'src/entities/user.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { OPEN_STATES } from './support-logic';

/**
 * Cron de SLA vencido: cada hora busca tickets abiertos cuyo `slaDueAt` ya pasó y
 * que aún no fueron avisados (`slaNotifiedAt IS NULL`), emite `ticket.sla_vencido`
 * al asignado (bell+correo) y marca `slaNotifiedAt` para no repetir. Best-effort.
 */
@Injectable()
export class SupportSlaCron {
  private readonly logger = new Logger(SupportSlaCron.name);

  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifier: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    await this.sweepFirstResponse();
    await this.sweepWarnings();
    await this.sweepOverdue();
  }

  /** Primera respuesta vencida: tickets abiertos sin respuesta del agente a tiempo. */
  private async sweepFirstResponse(): Promise<void> {
    let pending: SupportTicket[] = [];
    try {
      pending = await this.ticketRepo.find({
        where: {
          estado: In(OPEN_STATES as string[]),
          firstResponseDueAt: LessThan(new Date()),
          firstRespondedAt: IsNull(),
          firstResponseNotifiedAt: IsNull(),
        },
        take: 200,
      });
    } catch (e: any) {
      this.logger.warn(`SLA first-response sweep degradado: ${e?.message}`);
      return;
    }

    for (const t of pending) {
      try {
        const assigneeUserId = (await this.userIdByEmail(t.assigneeEmail)) ?? t.assigneeId ?? undefined;
        await this.notifier.emit({
          type: 'ticket.primera_respuesta_vencida',
          audience: assigneeUserId ? { userId: assigneeUserId } : { role: 'superadmin' },
          title: `Primera respuesta pendiente: ${t.folio}`,
          body: `El ticket "${t.titulo}" (${t.prioridad}) aún no recibe una primera respuesta dentro del objetivo.`,
          link: `/support/admin?ticket=${t.id}`,
          entityId: t.id,
          subsidiaryId: t.subsidiaryId ?? undefined,
        });
        await this.ticketRepo.update({ id: t.id }, { firstResponseNotifiedAt: new Date() });
      } catch (e: any) {
        this.logger.warn(`aviso de primera respuesta de ${t.folio} falló: ${e?.message}`);
      }
    }

    if (pending.length) this.logger.log(`Primera respuesta vencida: ${pending.length} ticket(s) avisados.`);
  }

  /** Aviso preventivo: tickets abiertos que pasaron su `slaWarnAt` y aún no vencen. */
  private async sweepWarnings(): Promise<void> {
    let soon: SupportTicket[] = [];
    try {
      const now = new Date();
      soon = await this.ticketRepo.find({
        where: {
          estado: In(OPEN_STATES as string[]),
          slaWarnAt: LessThan(now),
          slaDueAt: MoreThan(now), // aún no vencido → el vencido lo cubre el otro barrido
          slaWarnedAt: IsNull(),
        },
        take: 200,
      });
    } catch (e: any) {
      this.logger.warn(`SLA warn sweep degradado: ${e?.message}`);
      return;
    }

    for (const t of soon) {
      try {
        const assigneeUserId = (await this.userIdByEmail(t.assigneeEmail)) ?? t.assigneeId ?? undefined;
        await this.notifier.emit({
          type: 'ticket.sla_por_vencer',
          audience: assigneeUserId ? { userId: assigneeUserId } : { role: 'superadmin' },
          title: `SLA por vencer: ${t.folio}`,
          body: `El ticket "${t.titulo}" (${t.prioridad}) está por superar su tiempo objetivo de resolución.`,
          link: `/support/admin?ticket=${t.id}`,
          entityId: t.id,
          subsidiaryId: t.subsidiaryId ?? undefined,
        });
        await this.ticketRepo.update({ id: t.id }, { slaWarnedAt: new Date() });
      } catch (e: any) {
        this.logger.warn(`aviso preventivo de ${t.folio} falló: ${e?.message}`);
      }
    }

    if (soon.length) this.logger.log(`SLA por vencer: ${soon.length} ticket(s) avisados.`);
  }

  private async sweepOverdue(): Promise<void> {
    let overdue: SupportTicket[] = [];
    try {
      overdue = await this.ticketRepo.find({
        where: {
          estado: In(OPEN_STATES as string[]),
          slaDueAt: LessThan(new Date()),
          slaNotifiedAt: IsNull(),
        },
        take: 200,
      });
    } catch (e: any) {
      this.logger.warn(`SLA sweep degradado: ${e?.message}`);
      return;
    }

    for (const t of overdue) {
      try {
        const assigneeUserId = await this.userIdByEmail(t.assigneeEmail) ?? t.assigneeId ?? undefined;
        await this.notifier.emit({
          type: 'ticket.sla_vencido',
          audience: assigneeUserId ? { userId: assigneeUserId } : { role: 'superadmin' },
          title: `SLA vencido: ${t.folio}`,
          body: `El ticket "${t.titulo}" (${t.prioridad}) superó su tiempo objetivo de resolución.`,
          link: `/support/admin?ticket=${t.id}`,
          entityId: t.id,
          subsidiaryId: t.subsidiaryId ?? undefined,
        });
        await this.ticketRepo.update({ id: t.id }, { slaNotifiedAt: new Date() });
      } catch (e: any) {
        this.logger.warn(`aviso SLA de ${t.folio} falló: ${e?.message}`);
      }
    }

    if (overdue.length) this.logger.log(`SLA vencido: ${overdue.length} ticket(s) avisados.`);
  }

  private async userIdByEmail(email?: string | null): Promise<string | undefined> {
    if (!email) return undefined;
    try {
      const u = await this.userRepo.findOne({ where: { email: email.toLowerCase() }, select: ['id'] });
      return u?.id;
    } catch {
      return undefined;
    }
  }
}
