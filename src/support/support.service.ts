import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { SupportTicketCommentAttachment } from 'src/entities/support-ticket-comment-attachment.entity';
import { SupportTicketRead } from 'src/entities/support-ticket-read.entity';
import { User } from 'src/entities/user.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import {
  findAgentById, defaultAgent, getSupportAgents, getInitialPriority,
  slaDueAtFor, slaWarnAtFor, firstResponseDueAtFor,
} from './support-config';
import { isSlaBreached, urgencyScore, hoursBetween, isResolved, commentReadState } from './support-logic';
import { buildPrompt } from './prompt-builder';
import { CodeLocatorService } from './code-locator.service';
import { buildAiRefinementMessages } from './ai-prompt';
import { DeepseekService, DeepseekDisabledError } from '../ai/deepseek.service';
import { SupportApprovalService, ApprovalActor } from './support-approval.service';
import { initialApprovalStatus, isBlockedByApproval, isSuperRole } from './approval-logic';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

type ReqUser = { userId: string; name?: string; lastName?: string; email?: string; subsidiaryId?: string; role?: string };

/** Estados cuyo cambio dispara el aviso al grupo de WhatsApp (evita ruido). */
const GROUP_NOTIFY_STATES = ['en_progreso', 'completado', 'rechazado'];

/** Etiquetas legibles de estado (para el mensaje de WhatsApp/campana al solicitante). */
const STATUS_LABELS: Record<string, string> = {
  pendiente: 'En espera (backlog)',
  por_hacer: 'Por hacer',
  en_progreso: 'En progreso',
  en_revision: 'En revisión',
  completado: 'Completado',
  rechazado: 'Rechazado',
};

/** Ticket con campos calculados para el tablero (no persistidos). */
export type TicketView = SupportTicket & {
  urgencyScore: number;
  slaBreached: boolean;
  ageHours: number;
  timeInColumnHours: number;
  workedHours: number | null;
  zoneId: string | null;
  commentsCount: number;
  unread: boolean;
};

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketComment) private readonly commentRepo: Repository<SupportTicketComment>,
    @InjectRepository(SupportTicketAttachment) private readonly attachmentRepo: Repository<SupportTicketAttachment>,
    @InjectRepository(SupportTicketCommentAttachment) private readonly commentAttachmentRepo: Repository<SupportTicketCommentAttachment>,
    @InjectRepository(SupportTicketRead) private readonly readRepo: Repository<SupportTicketRead>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifier: NotificationsService,
    private readonly locator: CodeLocatorService,
    private readonly deepseek: DeepseekService,
    private readonly approval: SupportApprovalService,
  ) {}

  /** Diagnóstico de canales de notificación (bell/email/whatsapp). */
  channelHealth() {
    return this.notifier.channelHealth();
  }

  /** Envía una notificación de prueba al usuario por los 3 canales. */
  sendChannelTest(userId: string) {
    return this.notifier.sendChannelTest(userId);
  }

  /**
   * Notifica el estatus actual del ticket a su creador: campana (siempre) +
   * WhatsApp al teléfono registrado del usuario (con resultado para la UI).
   */
  async notifyStatusToRequester(id: string): Promise<{ whatsapp: { sent: boolean; error?: string }; hasPhone: boolean }> {
    const t = await this.ticketRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    const requester = await this.userRepo.findOne({ where: { id: t.requesterId }, select: ['id', 'phone', 'name'] as any });
    const estadoLabel = STATUS_LABELS[t.estado] ?? t.estado.replace('_', ' ');
    const title = `Estatus de tu ticket ${t.folio}`;
    const body = `"${t.titulo}" ahora está: ${estadoLabel}.` + (t.assigneeName ? ` Atiende: ${t.assigneeName}.` : '');

    await this.notifier.emit({
      type: 'ticket.estado',
      audience: { userId: t.requesterId },
      title,
      body,
      link: `/support/my-tickets?ticket=${id}`,
      entityId: id,
      channels: ['bell'],
    });

    const phone = (requester as any)?.phone as string | undefined;
    const whatsapp = phone
      ? await this.notifier.sendWhatsapp(phone, `*${title}*\n${body}`)
      : { sent: false, error: 'El usuario no tiene teléfono registrado.' };

    return { whatsapp, hasPhone: !!phone };
  }

  /**
   * El creador del ticket confirma (tras "Hecho") si quedó resuelto:
   * - resolved=true → sella `confirmedAt` (ticket cerrado) y avisa al asignado.
   * - resolved=false → regresa a "Por hacer", agrega el motivo como comentario y avisa.
   * Solo el solicitante (o superadmin) puede hacerlo, y solo si el ticket está en "Hecho".
   */
  async confirmResolution(id: string, actor: ReqUser, resolved: boolean, note?: string): Promise<TicketView> {
    const t = await this.ticketRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.requesterId !== actor.userId && !isSuperRole(actor.role)) {
      throw new ForbiddenException('Solo el creador del ticket puede confirmar la resolución.');
    }
    if (t.estado !== 'completado') {
      throw new BadRequestException('El ticket debe estar en "Hecho" para confirmar la resolución.');
    }

    const assigneeUserId = (await this.userIdByEmail(t.assigneeEmail)) ?? t.assigneeId ?? undefined;

    if (resolved) {
      await this.ticketRepo.update({ id }, { confirmedAt: new Date() });
      await this.notifier.emit({
        type: 'ticket.confirmado',
        audience: assigneeUserId ? { userId: assigneeUserId } : { role: 'superadmin' },
        title: `Resolución confirmada: ${t.folio}`,
        body: `El usuario confirmó que "${t.titulo}" quedó resuelto. Ticket cerrado.`,
        link: `/support/admin?ticket=${id}`, entityId: id,
        actor: { id: actor.userId, name: [actor.name, actor.lastName].filter(Boolean).join(' ') },
      });
    } else {
      await this.ticketRepo.update({ id }, { estado: 'por_hacer', resolvedAt: null, confirmedAt: null });
      if (note?.trim()) {
        await this.commentRepo.save(this.commentRepo.create({
          ticketId: id,
          authorId: actor.userId,
          authorName: [actor.name, actor.lastName].filter(Boolean).join(' ') || null,
          texto: `Reapertura: ${note.trim()}`,
          internal: false,
          createdAt: new Date(),
        }));
      }
      await this.notifier.emit({
        type: 'ticket.reabierto',
        audience: assigneeUserId ? { userId: assigneeUserId } : { role: 'superadmin' },
        title: `Reabierto por el usuario: ${t.folio}`,
        body: note?.trim() ? `"${t.titulo}" no quedó resuelto: ${note.trim()}` : `"${t.titulo}" no quedó resuelto.`,
        link: `/support/admin?ticket=${id}`, entityId: id,
        actor: { id: actor.userId, name: [actor.name, actor.lastName].filter(Boolean).join(' ') },
      });
    }

    return this.getOne(id);
  }

  /** Ruta local en disco a partir de la URL servida (`/api/uploads/...` → `uploads/...`). */
  private localPathFromUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    const rel = url.replace(/^\/api\/uploads\//, '');
    if (rel === url) return undefined; // no era una URL de uploads
    const p = path.join(process.cwd(), 'uploads', rel);
    try {
      return fs.existsSync(p) ? p : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Aviso al grupo de WhatsApp de Sistemas cuando la tarjeta cambia de estado:
   * datos del ticket + estatus + último comentario (con su imagen si tiene).
   */
  private async notifyGroupOnMove(t: TicketView): Promise<void> {
    const estadoLabel = STATUS_LABELS[t.estado] ?? t.estado.replace('_', ' ');
    const lines: string[] = [
      `🎫 *${t.folio}* → *${estadoLabel}*`,
      `*${t.titulo}*`,
      `Tipo: ${t.tipo} · Prioridad: ${t.prioridad}`,
    ];
    if (t.requesterName) lines.push(`Solicitante: ${t.requesterName}`);
    if (t.assigneeName) lines.push(`Atiende: ${t.assigneeName}`);
    if (t.workedHours != null) lines.push(`Trabajado: ${t.workedHours} h`);

    // Último comentario visible (no interno) + su primera imagen si tiene.
    const comments = (t.comentarios ?? []).filter((c) => !c.internal);
    const last = comments[comments.length - 1];
    let imagePath: string | undefined;
    if (last) {
      lines.push('', `💬 ${last.authorName ?? 'Comentario'}: ${last.texto}`);
      const img = (last.imagenes ?? [])[0];
      imagePath = this.localPathFromUrl(img?.url);
    }

    await this.notifier.sendSupportGroupCard(lines.join('\n'), imagePath);
  }

  // ---- Aprobación (D) ----
  async approveTicket(id: string, actor: ApprovalActor): Promise<TicketView> {
    await this.approval.approve(id, actor);
    return this.getOne(id);
  }
  async rejectTicket(id: string, actor: ApprovalActor, note: string): Promise<TicketView> {
    await this.approval.reject(id, actor, note);
    return this.getOne(id);
  }
  listAuthorizers(zoneId?: string) { return this.approval.listAuthorizers(zoneId); }
  addAuthorizer(zoneId: string, userId: string) { return this.approval.addAuthorizer(zoneId, userId); }
  removeAuthorizer(id: string) { return this.approval.removeAuthorizer(id); }
  myApprovalZones(userId: string) { return this.approval.myZones(userId); }

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
      // Tiempo trabajado: desde el inicio (en_progreso) hasta resolución o ahora.
      workedHours: t.startedAt
        ? Math.round(hoursBetween(t.startedAt, t.resolvedAt ? new Date(t.resolvedAt) : now) * 10) / 10
        : null,
      zoneId: null,
      commentsCount: t.comentarios?.length ?? 0,
      unread: false,
    }) as TicketView;
  }

  /** Marca por usuario si cada ticket tiene comentarios NUEVOS (para el tablero). */
  private async attachReadState(views: TicketView[], viewerId?: string): Promise<TicketView[]> {
    if (!viewerId || views.length === 0) return views;
    let seen = new Map<string, Date>();
    try {
      const rows = await this.readRepo.find({
        where: { userId: viewerId, ticketId: In(views.map((v) => String(v.id))) },
      });
      seen = new Map(rows.map((r) => [r.ticketId, r.lastViewedAt]));
    } catch {
      /* degrada: sin marca de lectura, nada "nuevo" */
    }
    for (const v of views) {
      const state = commentReadState(v.comentarios ?? [], viewerId, seen.get(String(v.id)) ?? null);
      v.commentsCount = state.count;
      v.unread = state.unread;
    }
    return views;
  }

  /** Registra que el usuario vio el ticket (limpia el "nuevo"). */
  async markSeen(userId: string, ticketId: string): Promise<{ ok: boolean }> {
    try {
      await this.readRepo.upsert({ userId, ticketId, lastViewedAt: new Date() }, ['userId', 'ticketId']);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** Resuelve la zona (vía sucursal) de una lista de vistas, en un solo query. */
  private async attachZones(views: TicketView[]): Promise<TicketView[]> {
    const map = await this.approval.zoneMap(views.map((v) => v.subsidiaryId));
    for (const v of views) v.zoneId = v.subsidiaryId ? map.get(v.subsidiaryId) ?? null : null;
    return views;
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
      approvalStatus: initialApprovalStatus(dto.tipo),
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

    // Si la mejora requiere aprobación, avisa a los autorizadores de la zona.
    if (ticket.approvalStatus === 'pendiente') {
      await this.approval.notifyPendingApproval(ticket);
    }

    return this.getOne(ticket.id);
  }

  async list(
    filters: { estado?: string; tipo?: string; prioridad?: string; q?: string; sucursal?: string; asignado?: string } = {},
    viewerId?: string,
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
    const views = await this.attachZones(rows.map((t) => this.serialize(t, now)));
    return this.attachReadState(views, viewerId);
  }

  async listMine(userId: string): Promise<TicketView[]> {
    const rows = await this.ticketRepo.find({
      where: { requesterId: userId },
      relations: ['comentarios', 'comentarios.imagenes', 'imagenes'],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return this.attachZones(rows.map((t) => this.serialize(t, now)));
  }

  async getOne(id: string): Promise<TicketView> {
    const t = await this.ticketRepo.findOne({ where: { id }, relations: ['comentarios', 'comentarios.imagenes', 'imagenes'] });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return (await this.attachZones([this.serialize(t)]))[0];
  }

  async update(id: string, dto: UpdateTicketDto, actor: ReqUser): Promise<TicketView> {
    const t = await this.getOne(id);
    const patch: Partial<SupportTicket> = { updatedAt: new Date() };

    // Bloqueo duro: una mejora pendiente de aprobación no avanza a estados de
    // trabajo, salvo override del superadmin.
    if (dto.estado && isBlockedByApproval(t.approvalStatus, dto.estado, isSuperRole(actor.role))) {
      throw new ForbiddenException('Este ticket requiere aprobación de la zona antes de pasar a desarrollo.');
    }

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
      // Fecha de inicio de trabajo: la primera vez que entra a "en progreso".
      if (dto.estado === 'en_progreso' && !t.startedAt) {
        patch.startedAt = new Date();
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
      // Aviso al grupo de WhatsApp solo en transiciones clave (En progreso / Hecho / Rechazado).
      if (GROUP_NOTIFY_STATES.includes(updated.estado)) {
        void this.notifyGroupOnMove(updated).catch(() => undefined);
      }
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

  async addComment(
    id: string,
    dto: AddCommentDto,
    author: ReqUser,
    files: Express.Multer.File[] = [],
  ): Promise<TicketView> {
    const t = await this.getOne(id);
    // `internal` puede venir como boolean (JSON) o string (multipart).
    const internal = dto.internal === true || dto.internal === 'true';
    // Nota interna solo tiene sentido para el equipo; el solicitante nunca la usa.
    const isAgentComment = author.userId !== t.requesterId;
    const isInternal = internal && isAgentComment;

    const comment = await this.commentRepo.save(this.commentRepo.create({
      ticketId: id,
      authorId: author.userId,
      authorName: [author.name, author.lastName].filter(Boolean).join(' ') || null,
      texto: dto.texto,
      internal: isInternal,
      createdAt: new Date(),
    }));

    for (const f of files ?? []) {
      await this.commentAttachmentRepo.save(this.commentAttachmentRepo.create({
        commentId: comment.id,
        filename: f.filename,
        url: `/api/uploads/support/comments/${path.basename(path.dirname(f.path))}/${f.filename}`,
        mime: f.mimetype,
        size: f.size,
      }));
    }

    // El primer comentario del agente cuenta como primera respuesta (SLA).
    if (isAgentComment && !t.firstRespondedAt) {
      await this.ticketRepo.update({ id }, { firstRespondedAt: new Date() });
    }

    if (!isInternal) {
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
