import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { getSupportAgents } from './support-agents';

type ReqUser = { userId: string; name?: string; lastName?: string; email?: string; subsidiaryId?: string };

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketComment) private readonly commentRepo: Repository<SupportTicketComment>,
    @InjectRepository(SupportTicketAttachment) private readonly attachmentRepo: Repository<SupportTicketAttachment>,
    private readonly notifier: NotificationsService,
  ) {}

  async nextFolio(): Promise<string> {
    const n = (await this.ticketRepo.count()) + 1;
    return `SUP-${String(n).padStart(4, '0')}`;
  }

  private supportAgentUserId(): string | undefined {
    // El destinatario del equipo. Hoy = Javier (config). Su userId real se
    // resuelve por email si existe; si no, se notifica por correo/WhatsApp igual.
    return process.env.SUPPORT_AGENT_USER_ID || undefined;
  }

  async create(dto: CreateTicketDto, user: ReqUser, files: Express.Multer.File[]): Promise<SupportTicket> {
    const folio = await this.nextFolio();
    const ticket = await this.ticketRepo.save(this.ticketRepo.create({
      ...dto,
      folio,
      estado: 'pendiente',
      prioridad: 'media',
      requesterId: user.userId,
      requesterName: [user.name, user.lastName].filter(Boolean).join(' ') || null,
      requesterEmail: user.email ?? null,
      subsidiaryId: user.subsidiaryId ?? null,
      createdAt: new Date(),
    }));

    for (const f of files ?? []) {
      // NOTA (reconciliación T3/T4): el controller de subida (Task 4) usa multer
      // diskStorage con una carpeta ALEATORIA (no el id del ticket). La URL debe
      // derivarse de dónde realmente quedó el archivo (f.path), no de ticket.id.
      await this.attachmentRepo.save(this.attachmentRepo.create({
        ticketId: ticket.id,
        filename: f.filename,
        url: `/api/uploads/support/${path.basename(path.dirname(f.path))}/${f.filename}`,
        mime: f.mimetype,
        size: f.size,
      }));
    }

    const agentUserId = this.supportAgentUserId();
    await this.notifier.emit({
      type: 'ticket.creada',
      audience: agentUserId ? { userId: agentUserId } : { role: 'superadmin' },
      title: `Nuevo ticket ${folio}: ${ticket.titulo}`,
      body: ticket.descripcion,
      link: `/support/admin?ticket=${ticket.id}`,
      entityId: ticket.id,
      subsidiaryId: ticket.subsidiaryId ?? undefined,
      actor: { id: user.userId, name: ticket.requesterName ?? undefined },
    });

    return ticket;
  }

  async list(filters: { estado?: string; tipo?: string; q?: string } = {}): Promise<SupportTicket[]> {
    const qb = this.ticketRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.comentarios', 'c')
      .leftJoinAndSelect('t.imagenes', 'img')
      .orderBy('t.createdAt', 'DESC');
    if (filters.estado && filters.estado !== 'todos') qb.andWhere('t.estado = :e', { e: filters.estado });
    if (filters.tipo && filters.tipo !== 'todos') qb.andWhere('t.tipo = :ti', { ti: filters.tipo });
    if (filters.q) qb.andWhere('(t.titulo LIKE :q OR t.descripcion LIKE :q OR t.requesterName LIKE :q)', { q: `%${filters.q}%` });
    return qb.getMany();
  }

  async listMine(userId: string): Promise<SupportTicket[]> {
    return this.ticketRepo.find({
      where: { requesterId: userId },
      relations: ['comentarios', 'imagenes'],
      order: { createdAt: 'DESC' },
    });
  }

  async getOne(id: string): Promise<SupportTicket> {
    const t = await this.ticketRepo.findOne({ where: { id }, relations: ['comentarios', 'imagenes'] });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return t;
  }

  async update(id: string, dto: UpdateTicketDto, actor: ReqUser): Promise<SupportTicket> {
    const t = await this.getOne(id);
    const patch: Partial<SupportTicket> = { updatedAt: new Date() };

    if (dto.assigneeId && dto.assigneeId !== t.assigneeId) {
      const agent = getSupportAgents().find((a) => a.id === dto.assigneeId);
      patch.assigneeId = dto.assigneeId;
      patch.assigneeName = agent?.nombre ?? dto.assigneeId;
    }
    if (dto.estado && dto.estado !== t.estado) {
      patch.estado = dto.estado;
      if (dto.estado === 'completado' || dto.estado === 'rechazado') patch.resolvedAt = new Date();
    }
    if (dto.prioridad) patch.prioridad = dto.prioridad;

    await this.ticketRepo.update({ id }, patch);
    const updated = await this.getOne(id);

    // Notificaciones declarativas
    if (patch.assigneeId) {
      await this.notifier.emit({
        type: 'ticket.asignado', audience: { userId: updated.assigneeId! },
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

  async addComment(id: string, dto: AddCommentDto, author: ReqUser): Promise<SupportTicket> {
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
}
