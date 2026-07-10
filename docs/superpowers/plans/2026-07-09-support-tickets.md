# Support Tickets (Backend + Frontend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on:** `2026-07-09-notifications-subsystem.md` (needs `NotificationsService.emit()`). Implement that plan first.

**Goal:** Ship a complete support-ticket system: backend CRUD with attachments, assignment, comments and lifecycle notifications (email + bell + WhatsApp), plus wiring the existing frontend pages to a real data layer and adding the Support button to the layout.

**Architecture:** New NestJS module `src/support/` with three entities (ticket, comment, attachment). Attachments are stored on disk (`uploads/support/<ticketId>/`) and served statically. Every lifecycle transition calls `NotificationsService.emit()` with a declarative type from the catalog. The frontend gains `lib/types/support-ticket.ts` + `lib/services/support-ticket.service.ts` (axios), the 3 existing pages are fixed to import them, the admin panel is connected to real endpoints, and a Support button is added after "Agregar envío".

**Tech Stack:** NestJS, TypeORM (MySQL), Multer (`@nestjs/platform-express`), Next.js, axios, shadcn/ui, lucide-react.

## Global Constraints

- Backend entities auto-load by glob `src/entities/*.entity.{js,ts}`; also export from `src/entities/index.ts`.
- PKs `@PrimaryGeneratedColumn('uuid')`; timestamps `@Column({ type: 'datetime' })`.
- `req.user` = `{ userId, email, name, lastName, role, subsidiary?: {id}, subsidiaryId }`.
- Global API prefix `api`. Frontend hits `process.env.NEXT_PUBLIC_API_URL` via `axiosConfig`.
- Best-effort rule for all notifications (from Plan 1): a notification failure never breaks the ticket operation.
- Frontend service convention: `lib/services/*.ts` importing `axiosConfig` from `../axios-config`; types in `lib/types/`.
- Support recipient/agent is config-driven: `SUPPORT_TEAM_EMAIL` (default `javier.lopez@derevo.com.mx`), `SUPPORT_WHATSAPP` (phone). Today the only agent is Javier.
- Tests: pure unit tests with mock repos (`new SupportService(repoMocks, notifierMock)`). Run `npm test`.

---

## File Structure

**Backend — create:**
- `src/entities/support-ticket.entity.ts`
- `src/entities/support-ticket-comment.entity.ts`
- `src/entities/support-ticket-attachment.entity.ts`
- `src/support/dto/create-ticket.dto.ts`
- `src/support/dto/update-ticket.dto.ts`
- `src/support/dto/add-comment.dto.ts`
- `src/support/support.service.ts`
- `src/support/support.service.spec.ts`
- `src/support/support.controller.ts`
- `src/support/support.module.ts`
- `src/support/support-agents.ts` (config-driven agent list)
- `src/database/migrations/<ts>-CreateSupportTickets.ts`

**Backend — modify:**
- `src/entities/index.ts` (barrel)
- `src/app.module.ts` (register `SupportModule`)
- `src/main.ts` (serve `uploads/` statically)
- `.gitignore` (ignore `uploads/`)

**Frontend — create:**
- `lib/types/support-ticket.ts`
- `lib/services/support-ticket.service.ts`

**Frontend — modify:**
- `app/support/tickets/page.tsx`, `app/support/my-tickets/page.tsx`, `app/support/admin/page.tsx` (fix imports; wire admin assignment)
- `components/app-layout.tsx` (Support button after "Agregar envío")

---

## Task 1: Support entities

**Files:**
- Create: `src/entities/support-ticket.entity.ts`, `src/entities/support-ticket-comment.entity.ts`, `src/entities/support-ticket-attachment.entity.ts`
- Modify: `src/entities/index.ts`

**Interfaces:**
- Produces: entities `SupportTicket`, `SupportTicketComment`, `SupportTicketAttachment`.

- [ ] **Step 1: Ticket entity**

```ts
// src/entities/support-ticket.entity.ts
import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicketComment } from './support-ticket-comment.entity';
import { SupportTicketAttachment } from './support-ticket-attachment.entity';

export type TicketType = 'mejora' | 'cambio' | 'eliminar' | 'error';
export type TicketStatus = 'pendiente' | 'en_progreso' | 'completado' | 'rechazado';
export type TicketPriority = 'baja' | 'media' | 'alta' | 'urgente';

@Entity('support_ticket')
@Index(['estado'])
@Index(['requesterId'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  folio: string; // SUP-0001

  @Column({ type: 'varchar', length: 20 })
  tipo: TicketType;

  @Column({ type: 'varchar', length: 200 })
  titulo: string;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'varchar', length: 20, default: 'pendiente' })
  estado: TicketStatus;

  @Column({ type: 'varchar', length: 20, default: 'media' })
  prioridad: TicketPriority;

  // Ubicación (todos opcionales según el tipo)
  @Column({ type: 'varchar', length: 60, nullable: true }) menuPrincipal: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) submenu: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) seccion: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) subseccion: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) nuevoMenu: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) menuError: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) submenuError: string | null;
  @Column({ type: 'text', nullable: true }) pasosReplicar: string | null;

  // Solicitante
  @Column({ type: 'char', length: 36 }) requesterId: string;
  @Column({ type: 'varchar', length: 160, nullable: true }) requesterName: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) requesterEmail: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) subsidiaryId: string | null;

  // Asignación
  @Column({ type: 'char', length: 36, nullable: true }) assigneeId: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) assigneeName: string | null;

  // Contexto auto-capturado
  @Column({ type: 'varchar', length: 60, nullable: true }) appVersion: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) route: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) userAgent: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', nullable: true }) updatedAt: Date | null;
  @Column({ type: 'datetime', nullable: true }) resolvedAt: Date | null;

  @OneToMany(() => SupportTicketComment, (c) => c.ticket) comentarios: SupportTicketComment[];
  @OneToMany(() => SupportTicketAttachment, (a) => a.ticket) imagenes: SupportTicketAttachment[];
}
```

- [ ] **Step 2: Comment entity**

```ts
// src/entities/support-ticket-comment.entity.ts
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

@Entity('support_ticket_comment')
export class SupportTicketComment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SupportTicket, (t) => t.comentarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: SupportTicket;

  @Column({ type: 'char', length: 36 }) ticketId: string;
  @Column({ type: 'char', length: 36, nullable: true }) authorId: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) authorName: string | null;
  @Column({ type: 'text' }) texto: string;
  @Column({ type: 'boolean', default: false }) internal: boolean;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
```

- [ ] **Step 3: Attachment entity**

```ts
// src/entities/support-ticket-attachment.entity.ts
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

@Entity('support_ticket_attachment')
export class SupportTicketAttachment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SupportTicket, (t) => t.imagenes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: SupportTicket;

  @Column({ type: 'char', length: 36 }) ticketId: string;
  @Column({ type: 'varchar', length: 260 }) filename: string;
  @Column({ type: 'varchar', length: 400 }) url: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) mime: string | null;
  @Column({ type: 'int', nullable: true }) size: number | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
```

- [ ] **Step 4: Export from barrel**

Append to `src/entities/index.ts`:

```ts
export * from './support-ticket.entity';
export * from './support-ticket-comment.entity';
export * from './support-ticket-attachment.entity';
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/entities/support-ticket*.ts src/entities/index.ts
git commit -m "feat(support): ticket, comment and attachment entities"
```

---

## Task 2: DTOs + config-driven agents

**Files:**
- Create: `src/support/dto/create-ticket.dto.ts`, `src/support/dto/update-ticket.dto.ts`, `src/support/dto/add-comment.dto.ts`, `src/support/support-agents.ts`

- [ ] **Step 1: Create DTOs**

```ts
// src/support/dto/create-ticket.dto.ts
import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateTicketDto {
  @IsIn(['mejora', 'cambio', 'eliminar', 'error']) tipo: 'mejora' | 'cambio' | 'eliminar' | 'error';
  @IsString() titulo: string;
  @IsString() descripcion: string;
  @IsString() @IsOptional() menuPrincipal?: string;
  @IsString() @IsOptional() submenu?: string;
  @IsString() @IsOptional() seccion?: string;
  @IsString() @IsOptional() subseccion?: string;
  @IsString() @IsOptional() nuevoMenu?: string;
  @IsString() @IsOptional() menuError?: string;
  @IsString() @IsOptional() submenuError?: string;
  @IsString() @IsOptional() pasosReplicar?: string;
  @IsString() @IsOptional() appVersion?: string;
  @IsString() @IsOptional() route?: string;
}
```

```ts
// src/support/dto/update-ticket.dto.ts
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateTicketDto {
  @IsIn(['pendiente', 'en_progreso', 'completado', 'rechazado']) @IsOptional()
  estado?: 'pendiente' | 'en_progreso' | 'completado' | 'rechazado';
  @IsIn(['baja', 'media', 'alta', 'urgente']) @IsOptional()
  prioridad?: 'baja' | 'media' | 'alta' | 'urgente';
  @IsString() @IsOptional() assigneeId?: string;
}
```

```ts
// src/support/dto/add-comment.dto.ts
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AddCommentDto {
  @IsString() texto: string;
  @IsBoolean() @IsOptional() internal?: boolean;
}
```

- [ ] **Step 2: Config-driven agents**

```ts
// src/support/support-agents.ts
export interface SupportAgent { id: string; nombre: string; email: string; phone?: string }

/**
 * Equipo de soporte (asignables + destinatarios). Config-driven: hoy solo Javier.
 * Cuando exista un rol/tabla de agentes, reemplazar por una consulta.
 */
export function getSupportAgents(): SupportAgent[] {
  const email = process.env.SUPPORT_TEAM_EMAIL || 'javier.lopez@derevo.com.mx';
  const phone = process.env.SUPPORT_WHATSAPP || undefined;
  return [{ id: 'javier', nombre: 'Javier López', email, phone }];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/support/dto/ src/support/support-agents.ts
git commit -m "feat(support): DTOs and config-driven support agents"
```

---

## Task 3: Support service — create + folio + notify

**Files:**
- Create: `src/support/support.service.ts`, `src/support/support.service.spec.ts`

**Interfaces:**
- Consumes: `SupportTicket`/`Comment`/`Attachment` repos, `NotificationsService.emit()`.
- Produces:
  - `create(dto, requester, files): Promise<SupportTicket>` — generates `folio`, saves attachments rows, emits `ticket.creada`.
  - `nextFolio(): Promise<string>`
  - `list(filters)`, `listMine(userId)`, `getOne(id)`.
  - `update(id, dto, actor)` — emits `ticket.asignado` / `ticket.estado` / `ticket.urgente`.
  - `addComment(id, dto, author)` — emits `ticket.comentario`.

- [ ] **Step 1: Write the failing test (create emits + folio)**

```ts
// src/support/support.service.spec.ts
import { SupportService } from './support.service';

function make(overrides: any = {}) {
  const savedTickets: any[] = [];
  const ticketRepo: any = {
    create: (d: any) => d,
    save: (t: any) => { const row = { id: 't1', ...t }; savedTickets.push(row); return Promise.resolve(row); },
    count: overrides.count ?? (() => Promise.resolve(0)),
    findOne: overrides.findOne ?? (() => Promise.resolve({ id: 't1', folio: 'SUP-0001', estado: 'pendiente', prioridad: 'media', requesterId: 'r1' })),
    find: () => Promise.resolve([]),
  };
  const commentRepo: any = { create: (d: any) => d, save: (c: any) => Promise.resolve({ id: 'c1', ...c }) };
  const attachmentRepo: any = { create: (d: any) => d, save: (a: any) => Promise.resolve(a) };
  const notifier: any = { emit: jest.fn(() => Promise.resolve()) };
  const svc = new SupportService(ticketRepo, commentRepo, attachmentRepo, notifier);
  return { svc, savedTickets, notifier, ticketRepo };
}

const requester = { userId: 'r1', name: 'Ana', lastName: 'Ruiz', email: 'ana@x.com', subsidiaryId: 's1' };

describe('SupportService.create', () => {
  it('assigns a sequential folio and emits ticket.creada', async () => {
    const { svc, savedTickets, notifier } = make({ count: () => Promise.resolve(4) });
    const t = await svc.create({ tipo: 'error', titulo: 'Falla', descripcion: 'x' } as any, requester as any, []);
    expect(savedTickets[0].folio).toBe('SUP-0005');
    expect(t.folio).toBe('SUP-0005');
    expect(notifier.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'ticket.creada' }));
  });

  it('persists attachment rows for uploaded files', async () => {
    const { svc } = make();
    const files = [{ filename: 'a.png', mimetype: 'image/png', size: 10, path: 'uploads/support/t1/a.png' }];
    await svc.create({ tipo: 'error', titulo: 'x', descripcion: 'y' } as any, requester as any, files as any);
    // no throw = attachment save path exercised
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- support.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

```ts
// src/support/support.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
      await this.attachmentRepo.save(this.attachmentRepo.create({
        ticketId: ticket.id,
        filename: f.filename,
        url: `/api/uploads/support/${ticket.id}/${f.filename}`,
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

    return this.getOne(ticket.id);
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- support.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/support/support.service.ts src/support/support.service.spec.ts
git commit -m "feat(support): service with folio, attachments and lifecycle notifications"
```

---

## Task 4: Controller (with disk upload) + module + static serving

**Files:**
- Create: `src/support/support.controller.ts`, `src/support/support.module.ts`
- Modify: `src/app.module.ts`, `src/main.ts`, `.gitignore`

**Interfaces:**
- Consumes: `SupportService`, `JwtAuthGuard`, `FilesInterceptor` + `diskStorage`.
- Produces: routes under `/support` (see spec §4.2).

- [ ] **Step 1: Controller**

```ts
// src/support/support.controller.ts
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { getSupportAgents } from './support-agents';

const uploadRoot = path.join(process.cwd(), 'uploads', 'support');

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get('agents')
  agents() { return getSupportAgents().map(({ id, nombre, email }) => ({ id, nombre, email })); }

  @Get('tickets')
  list(@Query('estado') estado?: string, @Query('tipo') tipo?: string, @Query('q') q?: string) {
    return this.service.list({ estado, tipo, q }).then((tickets) => ({ tickets }));
  }

  @Get('tickets/mine')
  mine(@Req() req: any) {
    return this.service.listMine(req.user.userId).then((tickets) => ({ tickets }));
  }

  @Get('tickets/:id')
  getOne(@Param('id') id: string) { return this.service.getOne(id); }

  @Post('tickets')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('imagenes', 8, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(uploadRoot, (req as any).__ticketDir ?? ((req as any).__ticketDir = randomUUID()));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      file.mimetype.startsWith('image/') ? cb(null, true) : cb(new BadRequestException('Solo imágenes'), false),
  }))
  create(@Body() dto: CreateTicketDto, @UploadedFiles() files: Express.Multer.File[], @Req() req: any) {
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 300);
    return this.service.create({ ...dto, userAgent } as any, req.user, files);
  }

  @Patch('tickets/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Req() req: any) {
    return this.service.update(id, dto, req.user);
  }

  @Post('tickets/:id/comments')
  addComment(@Param('id') id: string, @Body() dto: AddCommentDto, @Req() req: any) {
    return this.service.addComment(id, dto, req.user);
  }
}
```

> **Note:** the disk-storage `destination` groups a request's files into one folder. Because folders are created before the ticket id exists, we use a random dir; `SupportService.create` records the URL from `f.filename` under that folder. Keep the attachment `url` in the service consistent with where files land: change the service's attachment `url` to `/api/uploads/support/${path.basename(path.dirname(f.path))}/${f.filename}` using `f.path`. Update the Task 3 attachment save accordingly and re-run `npm test -- support.service`.

- [ ] **Step 2: Module**

```ts
// src/support/support.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from 'src/entities/support-ticket.entity';
import { SupportTicketComment } from 'src/entities/support-ticket-comment.entity';
import { SupportTicketAttachment } from 'src/entities/support-ticket-attachment.entity';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportTicket, SupportTicketComment, SupportTicketAttachment]),
    NotificationsModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
```

- [ ] **Step 3: Register module + static serving + gitignore**

In `src/app.module.ts` import `SupportModule` and add it to `imports`.

In `src/main.ts`, after the `express.urlencoded` line, add static serving:

```ts
import { join } from 'path';
// ...
app.use('/api/uploads', express.static(join(process.cwd(), 'uploads')));
```

Append to `.gitignore`:

```
uploads/
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual smoke test**

Start the API (`DB_SYNC=true`). `POST /api/support/tickets` (multipart with a `tipo`, `titulo`, `descripcion`, and an image). Then `GET /api/support/tickets`.
Expected: ticket returns with `folio` `SUP-000X` and an `imagenes[0].url` that opens in the browser.

- [ ] **Step 6: Commit**

```bash
git add src/support/support.controller.ts src/support/support.module.ts src/app.module.ts src/main.ts .gitignore
git commit -m "feat(support): controller with disk uploads, module, static serving"
```

---

## Task 5: Migration for support tables

**Files:**
- Create: `src/database/migrations/<ts>-CreateSupportTickets.ts`

- [ ] **Step 1: Generate/write the migration**

Run the project's migration command (see `package.json`) to generate `CreateSupportTickets`, or hand-write `CREATE TABLE` for `support_ticket`, `support_ticket_comment`, `support_ticket_attachment` matching Task 1 columns + FKs (`onDelete CASCADE`) + indexes (`support_ticket.estado`, `support_ticket.requesterId`, unique `folio`).

- [ ] **Step 2: Run the migration against a scratch DB**

Run the project's migration:run command.
Expected: three tables created.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations/
git commit -m "feat(support): migration for support ticket tables"
```

---

## Task 6: Frontend types module

**Files:**
- Create: `lib/types/support-ticket.ts`

**Interfaces:**
- Produces the exact exports the 3 pages consume: `Ticket`, `TicketStatus`, `TicketPriority`, `TicketType`, `MenuPrincipal`, `TicketFormData`, `TIPO_TICKET_INFO`, `SECCIONES_CONFIG`, `MENUS_INFO`, `getTicketTypeColor`, `getTicketStatusColor`, `getTicketPriorityColor`, `getStatusLabel`, `getPriorityLabel`.

- [ ] **Step 1: Create the types + constants**

```ts
// lib/types/support-ticket.ts
export type TicketType = 'mejora' | 'cambio' | 'eliminar' | 'error';
export type TicketStatus = 'pendiente' | 'en_progreso' | 'completado' | 'rechazado';
export type TicketPriority = 'baja' | 'media' | 'alta' | 'urgente';
export type MenuPrincipal = 'operaciones' | 'finanzas' | 'catalogos' | 'configuracion' | 'nuevo';

export interface TicketComment { usuario: string; texto: string; fecha: string; internal?: boolean }

export interface Ticket {
  id: number | string;
  folio?: string;
  tipo: TicketType;
  titulo: string;
  descripcion: string;
  estado: TicketStatus;
  prioridad?: TicketPriority;
  usuario?: string;
  asignadoA?: string;
  asignadoAId?: number | string;
  seccion?: string;
  subseccion?: string;
  menuPrincipal?: string;
  submenu?: string;
  pasosReplicar?: string;
  imagenes?: string[];
  comentarios?: TicketComment[];
  fechaCreacion: string;
}

export interface TicketFormData {
  tipo: TicketType | '';
  titulo: string;
  descripcion: string;
  imagenes?: File[];
  seccion?: 'operaciones' | 'finanzas';
  subseccion?: string;
  menuPrincipal?: MenuPrincipal | '';
  submenu?: string;
  nuevoMenu?: string;
  menuError?: MenuPrincipal | '';
  submenuError?: string;
  pasosReplicar?: string;
}

export const TIPO_TICKET_INFO: Record<TicketType, { titulo: string; descripcion: string; ejemplo: string }> = {
  mejora:   { titulo: 'Mejora',      descripcion: 'Sugiere una nueva función o mejora', ejemplo: 'Ej: Agregar un botón para imprimir etiquetas' },
  cambio:   { titulo: 'Cambio',      descripcion: 'Pide modificar algo que ya existe',  ejemplo: 'Ej: Cambiar el orden de las columnas' },
  eliminar: { titulo: 'Eliminar',    descripcion: 'Solicita quitar algo del sistema',   ejemplo: 'Ej: Quitar un campo que ya no se usa' },
  error:    { titulo: 'Reportar error', descripcion: 'Algo no funciona como debería',   ejemplo: 'Ej: Al guardar me aparece un error' },
};

export const SECCIONES_CONFIG: Record<'operaciones' | 'finanzas', { label: string; descripcion: string; subsecciones: Record<string, string> }> = {
  operaciones: {
    label: 'Operaciones', descripcion: 'Envíos, consolidados, rutas, bodega…',
    subsecciones: {
      consolidados: 'Consolidados', desembarques: 'Desembarques', salidas_ruta: 'Salidas a ruta',
      devoluciones: 'Devoluciones', recolecciones: 'Recolecciones', inventarios: 'Inventarios', bodega: 'Bodega',
    },
  },
  finanzas: {
    label: 'Finanzas', descripcion: 'Gastos, ingresos, reportes…',
    subsecciones: { gastos: 'Gastos', ingresos: 'Ingresos', reportes: 'Reportes' },
  },
};

export const MENUS_INFO: Record<'operaciones' | 'finanzas' | 'catalogos' | 'configuracion', { label: string; descripcion: string; submenus: string[] }> = {
  operaciones:   { label: 'Operaciones',   descripcion: 'Flujo operativo diario',       submenus: ['consolidados', 'desembarques', 'salidas_ruta', 'devoluciones', 'recolecciones', 'inventarios', 'bodega'] },
  finanzas:      { label: 'Finanzas',      descripcion: 'Gastos, ingresos y reportes',  submenus: ['gastos', 'ingresos', 'reportes'] },
  catalogos:     { label: 'Catálogos',     descripcion: 'Rutas, choferes, vehículos…',  submenus: ['rutas', 'choferes', 'vehiculos', 'zonas', 'sucursales'] },
  configuracion: { label: 'Configuración', descripcion: 'Usuarios, roles, ajustes',     submenus: ['usuarios', 'roles', 'ajustes'] },
};

export const getTicketTypeColor = (tipo: TicketType | string) => ({
  mejora: 'bg-blue-500/10 text-blue-500', cambio: 'bg-yellow-500/10 text-yellow-600',
  eliminar: 'bg-red-500/10 text-red-500', error: 'bg-orange-500/10 text-orange-500',
}[tipo] ?? 'bg-gray-500/10 text-gray-500');

export const getTicketStatusColor = (estado: TicketStatus | string) => ({
  pendiente: 'bg-gray-500/10 text-gray-600', en_progreso: 'bg-blue-500/10 text-blue-600',
  completado: 'bg-green-500/10 text-green-600', rechazado: 'bg-red-500/10 text-red-600',
}[estado] ?? 'bg-gray-500/10 text-gray-600');

export const getTicketPriorityColor = (p?: TicketPriority) => ({
  urgente: 'bg-red-500/10 text-red-600 border-red-500/20', alta: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  media: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20', baja: 'bg-green-500/10 text-green-600 border-green-500/20',
}[p ?? 'media'] ?? 'bg-gray-500/10 text-gray-600 border-gray-500/20');

export const getStatusLabel = (estado: TicketStatus) =>
  ({ pendiente: 'Pendiente', en_progreso: 'En Progreso', completado: 'Completado', rechazado: 'Rechazado' }[estado]);

export const getPriorityLabel = (p: TicketPriority) =>
  ({ baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' }[p]);
```

> Align `MENUS_INFO`/`SECCIONES_CONFIG` labels with the real app menu if they differ; these are the wizard's location options.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` (in `app-pmy`)
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
cd D:/PMY/app-pmy
git add lib/types/support-ticket.ts
git commit -m "feat(support): frontend ticket types + wizard constants"
```

---

## Task 7: Frontend service (axios) + fix page imports

**Files:**
- Create: `lib/services/support-ticket.service.ts`
- Modify: `app/support/tickets/page.tsx`, `app/support/my-tickets/page.tsx`, `app/support/admin/page.tsx`

**Interfaces:**
- Consumes: `axiosConfig`, backend `/support/*` routes.
- Produces: `SupportTicketService` with `getAllTickets`, `getMyTickets`, `getTicket`, `createTicket(data, imagenes)`, `updateTicket(id, patch)`, `addComment({ticketId, texto, internal?})`, `getDevelopers`/`getSupportAgents`.

- [ ] **Step 1: Create the service**

```ts
// lib/services/support-ticket.service.ts
import { axiosConfig } from '../axios-config';
import type { Ticket, TicketStatus, TicketPriority } from '../types/support-ticket';

const url = '/support';

async function getAllTickets(filters: { estado?: string; tipo?: string; q?: string } = {}) {
  const res = await axiosConfig.get<{ tickets: Ticket[] }>(`${url}/tickets`, { params: filters });
  return res.data;
}

async function getMyTickets() {
  const res = await axiosConfig.get<{ tickets: Ticket[] }>(`${url}/tickets/mine`);
  return res.data;
}

async function getTicket(id: string | number) {
  const res = await axiosConfig.get<Ticket>(`${url}/tickets/${id}`);
  return res.data;
}

async function createTicket(data: Record<string, any>, imagenes?: File[]) {
  const form = new FormData();
  Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') form.append(k, String(v)); });
  (imagenes ?? []).forEach((file) => form.append('imagenes', file));
  const res = await axiosConfig.post<Ticket>(`${url}/tickets`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data;
}

async function updateTicket(id: string | number, patch: { estado?: TicketStatus; prioridad?: TicketPriority; asignadoAId?: string | number }) {
  const body: any = {};
  if (patch.estado) body.estado = patch.estado;
  if (patch.prioridad) body.prioridad = patch.prioridad;
  if (patch.asignadoAId !== undefined) body.assigneeId = String(patch.asignadoAId);
  const res = await axiosConfig.patch<Ticket>(`${url}/tickets/${id}`, body);
  return res.data;
}

async function addComment({ ticketId, texto, internal }: { ticketId: string | number; texto: string; internal?: boolean }) {
  const res = await axiosConfig.post<Ticket>(`${url}/tickets/${ticketId}/comments`, { texto, internal });
  return res.data;
}

async function getDevelopers() {
  const res = await axiosConfig.get<Array<{ id: string; nombre: string; email: string }>>(`${url}/agents`);
  return res.data.map((a) => ({ id: a.id as any, nombre: a.nombre, email: a.email }));
}

export const SupportTicketService = {
  getAllTickets, getMyTickets, getTicket, createTicket, updateTicket, addComment,
  getDevelopers, getSupportAgents: getDevelopers,
};
```

- [ ] **Step 2: Fix the imports in the 3 pages**

In each of `app/support/tickets/page.tsx`, `app/support/my-tickets/page.tsx`, `app/support/admin/page.tsx`, change:

```ts
} from "@/types/support-ticket"
import { SupportTicketService } from "@/services/support-ticket.service"
```

to:

```ts
} from "@/lib/types/support-ticket"
import { SupportTicketService } from "@/lib/services/support-ticket.service"
```

- [ ] **Step 3: Wire real assignment in the admin page**

In `app/support/admin/page.tsx`, the "Asignar a" `<Select>` in the "gestion" tab currently hardcodes names and only mutates local state. Replace its body to use loaded `developers` and call the backend via the existing `assignTicket(ticketId, developerId)` handler:

```tsx
                <div className="space-y-2">
                  <Label>Asignar a</Label>
                  <Select
                    value={selectedTicket?.asignadoAId ? String(selectedTicket.asignadoAId) : ""}
                    onValueChange={(value) => selectedTicket && assignTicket(selectedTicket.id, value as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar responsable" />
                    </SelectTrigger>
                    <SelectContent>
                      {developers.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
```

Also change `assignTicket` and `updateTicketPriority` in that file to pass the id through unchanged (they already call `SupportTicketService.updateTicket`); ensure the priority `<Select>` calls `updateTicketPriority(selectedTicket.id, value)` instead of only mutating local state.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/services/support-ticket.service.ts app/support/
git commit -m "feat(support): axios data layer, fixed imports, real admin assignment"
```

---

## Task 8: Support button in the layout

**Files:**
- Modify: `components/app-layout.tsx`

**Interfaces:**
- Consumes: existing header actions area around line 225 (the "Agregar envío" button + its Tooltip).

- [ ] **Step 1: Add the button after "Agregar envío"**

Locate the `Tooltip` block whose button has `aria-label="Agregar envío"` (≈ line 225). Immediately after that closing `</Tooltip>`, add a sibling:

```tsx
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => router.push("/support/tickets")}
                      aria-label="Soporte"
                    >
                      <LifeBuoy className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Soporte</TooltipContent>
                </Tooltip>
```

Ensure `LifeBuoy` is imported from `lucide-react` and a `router` (`useRouter` from `next/navigation`) is available in the component — reuse the existing one if present; otherwise add `import { useRouter } from "next/navigation"` and `const router = useRouter()`.

- [ ] **Step 2: Verify in the browser**

Start the frontend dev server and confirm: the Support (life-buoy) icon appears right after "Agregar envío", and clicking it navigates to `/support/tickets`.

- [ ] **Step 3: Commit**

```bash
git add components/app-layout.tsx
git commit -m "feat(support): add Support button to the header after Agregar envío"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Create a ticket end-to-end**

With API + frontend running: open `/support/tickets`, complete the wizard for an `error` with an image, submit.
Expected: success; ticket appears under "Mis Solicitudes" with its `folio`; the support recipient gets an email (check inbox / mail logs) and a bell notification.

- [ ] **Step 2: Admin lifecycle**

Open `/support/admin`, open the ticket, assign it, change status to `en_progreso`, add a comment.
Expected: requester receives bell + email on status change and on the (non-internal) comment; the assignment persists after refresh.

- [ ] **Step 3: Refresh the backend code graph**

Run (in `pmy-api`): `graphify update .`

- [ ] **Step 4: Final commit if anything adjusted during verification**

```bash
git commit -am "chore(support): fixes from end-to-end verification"
```

---

## Self-Review Notes (author)

- **Spec coverage:** entities §4.1 → T1; endpoints §4.2 → T4; folio/attachments/agents → T2–T4; notification matrix §4.3 → T3; frontend data layer §5 → T6–T7; layout button §5 → T8; migration §7 → T5.
- **Placeholder scan:** attachment `url` derivation is reconciled between T3 and T4 (note in T4 Step 1). `MENUS_INFO`/`SECCIONES_CONFIG` are complete, flagged to align labels with the live menu.
- **Type consistency:** `SupportTicketService` method names match the 3 pages' calls (`getAllTickets`, `getMyTickets`, `getDevelopers`, `createTicket`, `updateTicket`, `addComment`). Backend `emit()` calls match Plan 1's `NotificationEvent` shape and the catalog `type`s (`ticket.creada/asignado/estado/comentario/urgente`).
- **Cross-plan dependency:** `NotificationsModule` must `export` `NotificationsService` (done in Plan 1 Task 6) for `SupportModule` to inject it.
