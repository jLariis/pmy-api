import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { User } from 'src/entities/user.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import {
  findAgentById, defaultAgent, getSupportAgents, getInitialPriority,
  slaDueAtFor, slaWarnAtFor, firstResponseDueAtFor,
} from './support-config';
import { isSlaBreached, urgencyScore, hoursBetween, isResolved } from './support-logic';
import { buildPrompt } from './prompt-builder';
import { CodeLocatorService } from './code-locator.service';
import { buildAiRefinementMessages } from './ai-prompt';
import { DeepseekService, DeepseekDisabledError } from '../ai/deepseek.service';

type ReqUser = { userId: string; name?: string; lastName?: string; email?: string; subsidiaryId?: string };

/** Ticket con campos calculados para el tablero (no persistidos). */
export type TicketView = SupportTicket & {
  urgencyScore: number;
  slaBreached: boolean;
  ageHours: number;
  timeInColumnHours: number;
};

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketComment) private readonly commentRepo: Repository<SupportTicketComment>,
    @InjectRepository(SupportTicketAttachment) private readonly attachmentRepo: Repository<SupportTicketAttachment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifier: NotificationsService,
    private readonly locator: CodeLocatorService,
    private readonly deepseek: DeepseekService,
  ) {}

  async nextFolio(): Promise<string> {
    const n = (await this.ticketRepo.count()) + 1;
    return `SUP-${String(n).padStart(4, '0')}`;
  }

  /** Resuelve el userId de un email (para dirigir bell+correo al asignado real). */
  private async userIdByEmail(email?: string | null): Promise<string | undefined> {
    if (!email) return undefined;
    const u = await this.userRepo.findOne({ where: { email: email.toLowerCase() }, select: ['id'] });
    return u?.id;
  }

  /** Agrega los campos calculados (urgencia, SLA, tiempos) a un ticket. */
  private serialize(t: SupportTicket, now = new Date()): TicketView {
    return Object.assign({}, t, {
      urgencyScore: urgencyScore(t, now),
      slaBreached: isSlaBreached(t, now),
      ageHours: Math.round(hoursBetween(t.createdAt, now) * 10) / 10,
      timeInColumnHours: Math.round(hoursBetween(t.updatedAt ?? t.createdAt, now) * 10) / 10,
    }) as TicketView;
  }

  async create(dto: CreateTicketDto, user: ReqUser, files: Express.Multer.File[]): Promise<TicketView> {
    const folio = await this.nextFolio();
    const now = new Date();
    const prioridad = getInitialPriority(dto.tipo);

    // Auto-asignación al agente default (admin@delyaqui.com), resolviendo su userId real.
    const agent = defaultAgent();
    const assigneeUserId = await this.userIdByEmail(agent.email);

    const ticket = await this.ticketRepo.save(this.ticketRepo.create({
      ...dto,
      folio,
      estado: 'pendiente',
      prioridad,
      requesterId: user.userId,
      requesterName: [user.name, user.lastName].filter(Boolean).join(' ') || null,
      requesterEmail: user.email ?? null,
      subsidiaryId: user.subsidiaryId ?? null,
      // Guardamos el id de config del agente (p.ej. 'admin') para que el dropdown de
      // reasignación lo refleje; el userId real se resuelve por email para notificar.
      assigneeId: agent.id,
      assigneeName: agent.nombre,
      assigneeEmail: agent.email,
      slaDueAt: slaDueAtFor(now, prioridad),
      slaWarnAt: slaWarnAtFor(now, prioridad),
      slaWarnedAt: null,
      slaNotifiedAt: null,
      firstResponseDueAt: firstResponseDueAtFor(now, prioridad),
      firstRespondedAt: null,
      firstResponseNotifiedAt: null,
      createdAt: now,
    }));

    for (const f of files ?? []) {
      // La URL se deriva de dónde realmente quedó el archivo (carpeta aleatoria del multer).
      await this.attachmentRepo.save(this.attachmentRepo.create({
        ticketId: ticket.id,
        filename: f.filename,
        url: `/api/uploads/support/${path.basename(path.dirname(f.path))}/${f.filename}`,
        mime: f.mimetype,
        size: f.size,
      }));
    }

    await this.notifier.emit({
      type: 'ticket.creada',
      audience: assigneeUserId ? { userId: assigneeUserId } : { role: 'superadmin' },
      title: `Nuevo ticket ${folio}: ${ticket.titulo}`,
      body: ticket.descripcion,
      link: `/support/admin?ticket=${ticket.id}`,
      entityId: ticket.id,
      subsidiaryId: ticket.subsidiaryId ?? undefined,
      actor: { id: user.userId, name: ticket.requesterName ?? undefined },
      data: agent.phone ? { whatsappTo: agent.phone } : undefined,
    });

    return this.getOne(ticket.id);
  }

  async list(
    filters: { estado?: string; tipo?: string; prioridad?: string; q?: string; sucursal?: string; asignado?: string } = {},
  ): Promise<TicketView[]> {
    const qb = this.ticketRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.comentarios', 'c')
      .leftJoinAndSelect('t.imagenes', 'img')
      .orderBy('t.createdAt', 'DESC');
    if (filters.estado && filters.estado !== 'todos') qb.andWhere('t.estado = :e', { e: filters.estado });
    if (filters.tipo && filters.tipo !== 'todos') qb.andWhere('t.tipo = :ti', { ti: filters.tipo });
    if (filters.prioridad && filters.prioridad !== 'todos') qb.andWhere('t.prioridad = :p', { p: filters.prioridad });
    if (filters.sucursal && filters.sucursal !== 'todos') qb.andWhere('t.subsidiaryId = :s', { s: filters.sucursal });
    if (filters.asignado && filters.asignado !== 'todos') qb.andWhere('t.assigneeId = :a', { a: filters.asignado });
    if (filters.q) qb.andWhere('(t.titulo LIKE :q OR t.descripcion LIKE :q OR t.requesterName LIKE :q OR t.folio LIKE :q)', { q: `%${filters.q}%` });
    const rows = await qb.getMany();
    const now = new Date();
    return rows.map((t) => this.serialize(t, now));
  }

  async listMine(userId: string): Promise<TicketView[]> {
    const rows = await this.ticketRepo.find({
      where: { requesterId: userId },
      relations: ['comentarios', 'imagenes'],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return rows.map((t) => this.serialize(t, now));
  }

  async getOne(id: string): Promise<TicketView> {
    const t = await this.ticketRepo.findOne({ where: { id }, relations: ['comentarios', 'imagenes'] });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return this.serialize(t);
  }

  async update(id: string, dto: UpdateTicketDto, actor: ReqUser): Promise<TicketView> {
    const t = await this.getOne(id);
    const patch: Partial<SupportTicket> = { updatedAt: new Date() };

    if (dto.assigneeId && dto.assigneeId !== t.assigneeId) {
      // Puede venir un id de agente config o un userId real; resolvemos ambos.
      const agent = findAgentById(dto.assigneeId) ?? getSupportAgents().find((a) => a.email === dto.assigneeId);
      patch.assigneeId = dto.assigneeId;
      patch.assigneeName = agent?.nombre ?? dto.assigneeId;
      patch.assigneeEmail = agent?.email ?? null;
    }
    if (dto.estado && dto.estado !== t.estado) {
      patch.estado = dto.estado;
      patch.resolvedAt = isResolved(dto.estado) ? new Date() : null;
      // Iniciar el trabajo (o revisarlo) cuenta como primera respuesta.
      if (!t.firstRespondedAt && (dto.estado === 'en_progreso' || dto.estado === 'en_revision')) {
        patch.firstRespondedAt = new Date();
      }
      // Reabrir un ticket resuelto reactiva su SLA (avisos incluidos).
      if (isResolved(t.estado) && !isResolved(dto.estado)) {
        patch.slaNotifiedAt = null;
        patch.slaWarnedAt = null;
      }
    }
    if (dto.prioridad && dto.prioridad !== t.prioridad) {
      patch.prioridad = dto.prioridad;
      // Recalcular SLA con la nueva prioridad y rearmar los avisos.
      patch.slaDueAt = slaDueAtFor(t.createdAt, dto.prioridad);
      patch.slaWarnAt = slaWarnAtFor(t.createdAt, dto.prioridad);
      patch.slaWarnedAt = null;
      patch.slaNotifiedAt = null;
      // La meta de primera respuesta también depende de la prioridad, mientras no se haya respondido.
      if (!t.firstRespondedAt) {
        patch.firstResponseDueAt = firstResponseDueAtFor(t.createdAt, dto.prioridad);
        patch.firstResponseNotifiedAt = null;
      }
    }

    await this.ticketRepo.update({ id }, patch);
    const updated = await this.getOne(id);

    // Notificaciones declarativas.
    if (patch.assigneeId) {
      const assigneeUserId = (await this.userIdByEmail(updated.assigneeEmail)) ?? updated.assigneeId!;
      await this.notifier.emit({
        type: 'ticket.asignado', audience: { userId: assigneeUserId },
        title: `Ticket ${updated.folio} asignado`, body: updated.titulo,
        link: `/support/admin?ticket=${id}`, entityId: id,
        actor: { id: actor.userId, name: [actor.name, actor.lastName].filter(Boolean).join(' ') },
      });
    }
    if (patch.estado) {
      await this.notifier.emit({
        type: 'ticket.estado', audience: { userId: updated.requesterId },
        title: `Tu ticket ${updated.folio} está ${updated.estado.replace('_', ' ')}`,
        body: updated.titulo, link: `/support/my-tickets?ticket=${id}`, entityId: id,
        actor: { id: actor.userId, name: [actor.name, actor.lastName].filter(Boolean).join(' ') },
      });
    }
    if (patch.prioridad === 'urgente') {
      await this.notifier.emit({
        type: 'ticket.urgente', audience: { role: 'superadmin' },
        title: `Ticket URGENTE ${updated.folio}`, body: updated.titulo,
        link: `/support/admin?ticket=${id}`, entityId: id,
      });
    }
    return updated;
  }

  async addComment(id: string, dto: AddCommentDto, author: ReqUser): Promise<TicketView> {
    const t = await this.getOne(id);
    await this.commentRepo.save(this.commentRepo.create({
      ticketId: id,
      authorId: author.userId,
      authorName: [author.name, author.lastName].filter(Boolean).join(' ') || null,
      texto: dto.texto,
      internal: dto.internal ?? false,
      createdAt: new Date(),
    }));

    // Si comenta el agente (no el solicitante) y no es nota interna → avisa al solicitante.
    const isAgentComment = author.userId !== t.requesterId;

    // El primer comentario del agente cuenta como primera respuesta (SLA).
    if (isAgentComment && !t.firstRespondedAt) {
      await this.ticketRepo.update({ id }, { firstRespondedAt: new Date() });
    }

    if (!dto.internal) {
      await this.notifier.emit({
        type: 'ticket.comentario',
        audience: isAgentComment ? { userId: t.requesterId } : { userId: t.assigneeId ?? t.requesterId },
        title: `Nuevo comentario en ${t.folio}`, body: dto.texto,
        link: isAgentComment ? `/support/my-tickets?ticket=${id}` : `/support/admin?ticket=${id}`,
        entityId: id,
        actor: { id: author.userId, name: [author.name, author.lastName].filter(Boolean).join(' ') },
      });
    }
    return this.getOne(id);
  }

  /**
   * Genera (on-demand, superadmin) un prompt para IA a partir del ticket.
   * - `deterministico` (default): plantilla + archivos/componentes reales del grafo.
   *   Cero costo de API, reproducible.
   * - `ia`: toma el prompt determinista y lo **mejora con DeepSeek** (conserva las
   *   rutas reales). Si la IA no está configurada o falla, cae al determinista con aviso.
   */
  async buildAiPrompt(
    id: string,
    engine: 'deterministico' | 'ia' = 'deterministico',
  ): Promise<{
    prompt: string;
    context: ReturnType<CodeLocatorService['contextFor']>;
    engine: 'deterministico' | 'ia';
    aiAvailable: boolean;
    warning?: string;
  }> {
    const t = await this.ticketRepo.findOne({ where: { id }, relations: ['imagenes'] });
    if (!t) throw new NotFoundException('Ticket no encontrado');

    const context = this.locator.contextFor({
      route: t.route,
      menuPrincipal: t.menuPrincipal,
      submenu: t.submenu,
      seccion: t.seccion,
      subseccion: t.subseccion,
      menuError: t.menuError,
      submenuError: t.submenuError,
      nuevoMenu: t.nuevoMenu,
      titulo: t.titulo,
      descripcion: t.descripcion,
      pasosReplicar: t.pasosReplicar,
    });

    const deterministicPrompt = buildPrompt({
      ticket: {
        folio: t.folio,
        tipo: t.tipo,
        titulo: t.titulo,
        descripcion: t.descripcion,
        pasosReplicar: t.pasosReplicar,
        menuPrincipal: t.menuPrincipal,
        submenu: t.submenu,
        seccion: t.seccion,
        subseccion: t.subseccion,
        nuevoMenu: t.nuevoMenu,
        menuError: t.menuError,
        submenuError: t.submenuError,
        route: t.route,
        appVersion: t.appVersion,
        imagenes: (t.imagenes ?? []).map((i) => ({ url: i.url })),
      },
      codeContext: context,
    });

    const aiAvailable = this.deepseek.isEnabled();

    if (engine !== 'ia') {
      return { prompt: deterministicPrompt, context, engine: 'deterministico', aiAvailable };
    }

    // Modo IA: mejorar el determinista con DeepSeek (best-effort, con fallback).
    try {
      const refined = await this.deepseek.complete(buildAiRefinementMessages(deterministicPrompt));
      return { prompt: refined, context, engine: 'ia', aiAvailable: true };
    } catch (e: any) {
      const warning =
        e instanceof DeepseekDisabledError
          ? 'IA no configurada (falta DEEPSEEK_API_KEY); se usó el generador determinista.'
          : `La IA no respondió (${e?.message ?? 'error'}); se usó el generador determinista.`;
      return { prompt: deterministicPrompt, context, engine: 'deterministico', aiAvailable, warning };
    }
  }
}
