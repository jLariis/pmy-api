# Notifications Subsystem + Audit Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class, targeted, multi-channel notification subsystem (`Notification` entity + `emit()` API) and migrate the existing audit-derived bell feed onto it without downtime.

**Architecture:** A `Notification` row per recipient (fan-out on write). `NotificationsService.emit(event)` resolves an audience → recipient ids, persists rows, and dispatches best-effort side channels (email via `MailerService`, WhatsApp via `WhatsappGatewayService`). The audit interceptor calls `emitFromAudit()` after each successful mutation, reusing the human-readable description it already computes. The feed unions new rows + the legacy audit-derived items during transition, then cuts over.

**Tech Stack:** NestJS, TypeORM (MySQL), `@nestjs-modules/mailer`, `@nestjs/schedule` (cron), Jest.

## Global Constraints

- Entities are auto-loaded by glob `src/entities/*.entity.{js,ts}`; also export from `src/entities/index.ts` barrel.
- Primary keys: `@PrimaryGeneratedColumn('uuid')`. Timestamps: `@Column({ type: 'datetime' })` (MySQL).
- `req.user` shape: `{ userId, email, name, lastName, role, subsidiary?: {id}, subsidiaryId }`.
- **Best-effort rule:** notification/email/WhatsApp failures MUST NEVER break the originating request. Wrap every side effect in try/catch + `logger.warn`. `emit()` never throws to its caller.
- Global route prefix is `api` (set in `main.ts`).
- Tests: pure unit tests — instantiate the service with mock repos (`new NotificationsService(repoMock, ...)`), no `Test.createTestingModule`. Run with `npm test`.
- DB schema changes ship as a migration in `src/database/migrations/`; dev may also rely on `DB_SYNC=true`.

---

## File Structure

**Create:**
- `src/entities/notification.entity.ts` — the `Notification` row.
- `src/notifications/notification-catalog.ts` — event type → presentation (icon/category/channels/link) + audit→type bridge.
- `src/notifications/notification.types.ts` — shared TS interfaces (`NotificationEvent`, `Audience`, `Channel`, `Category`, `Severity`).
- `src/notifications/notification-dispatch.service.ts` — side-channel delivery (email + WhatsApp), best-effort.
- `src/notifications/notification-dispatch.service.spec.ts`
- `src/notifications/emit.service.spec.ts` — unit tests for audience resolution + fan-out.
- `src/notifications/notifications.retention.ts` — cron pruning job.
- `src/database/migrations/<ts>-CreateNotification.ts`

**Modify:**
- `src/entities/index.ts` — export the new entity.
- `src/notifications/notifications.service.ts` — add `emit()`, `emitFromAudit()`, per-item read, union feed.
- `src/notifications/notifications.controller.ts` — add `POST /notifications/:id/read`.
- `src/notifications/notifications.module.ts` — register entities, providers, imports (Mailer, WhatsApp, User repo).
- `src/audit/audit.interceptor.ts` — call `emitFromAudit()` after successful mutations.
- `src/audit/audit.module.ts` — import `NotificationsModule` so the interceptor can inject the service.

---

## Task 1: `Notification` entity

**Files:**
- Create: `src/entities/notification.entity.ts`
- Modify: `src/entities/index.ts`

**Interfaces:**
- Produces: entity `Notification` with columns used by every later task.

- [ ] **Step 1: Create the entity**

```ts
// src/entities/notification.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationCategory = 'operacion' | 'soporte' | 'sesion' | 'sistema';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Notificación dirigida (una fila por destinatario). El feed de la campana se
 * arma leyendo estas filas para el usuario. Difusiones (p.ej. "alguien registró
 * un consolidado en tu sucursal") se expanden a N filas al emitir.
 */
@Entity('notification')
@Index(['recipientId', 'read'])
@Index(['recipientId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  recipientId: string;

  @Column({ type: 'varchar', length: 80 })
  type: string;

  @Column({ type: 'varchar', length: 20, default: 'operacion' })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  icon: string | null;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 300, nullable: true })
  link: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  actorName: string | null;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @Column({ type: 'datetime', nullable: true })
  readAt: Date | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
```

- [ ] **Step 2: Export from the barrel**

Add to `src/entities/index.ts` after the `notification-read.entity` line:

```ts
export * from './notification.entity';
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (entity auto-registers via glob).

- [ ] **Step 4: Commit**

```bash
git add src/entities/notification.entity.ts src/entities/index.ts
git commit -m "feat(notifications): add Notification entity (targeted, per-recipient)"
```

---

## Task 2: Shared types + event catalog

**Files:**
- Create: `src/notifications/notification.types.ts`
- Create: `src/notifications/notification-catalog.ts`

**Interfaces:**
- Produces:
  - `type Channel = 'bell' | 'email' | 'whatsapp'`
  - `type Audience = { userId: string } | { userIds: string[] } | { subsidiaryId: string; roles?: string[] } | { role: string } | { global: true }`
  - `interface NotificationEvent { type: string; audience: Audience; title?: string; body?: string; icon?: string; severity?: NotificationSeverity; category?: NotificationCategory; link?: string; entityId?: string; subsidiaryId?: string; actor?: { id?: string; name?: string }; channels?: Channel[]; data?: Record<string, any>; excludeActor?: boolean }`
  - `resolvePresentation(type, overrides): { category, icon, severity, channels }` from the catalog.
  - `auditToNotificationType(module: string, action?: string): string` bridge.

- [ ] **Step 1: Create the shared types**

```ts
// src/notifications/notification.types.ts
import { NotificationCategory, NotificationSeverity } from 'src/entities/notification.entity';

export type Channel = 'bell' | 'email' | 'whatsapp';

export type Audience =
  | { userId: string }
  | { userIds: string[] }
  | { subsidiaryId: string; roles?: string[] }
  | { role: string }
  | { global: true };

export interface NotificationEvent {
  type: string;
  audience: Audience;
  title?: string;
  body?: string;
  icon?: string;
  severity?: NotificationSeverity;
  category?: NotificationCategory;
  link?: string;
  entityId?: string;
  subsidiaryId?: string;
  actor?: { id?: string; name?: string };
  channels?: Channel[];
  /** Contexto para plantillas de correo / WhatsApp. */
  data?: Record<string, any>;
  /** En difusiones, excluye al actor de los destinatarios (default true). */
  excludeActor?: boolean;
}
```

- [ ] **Step 2: Create the catalog with a failing test target**

```ts
// src/notifications/notification-catalog.ts
import { Channel } from './notification.types';
import { NotificationCategory, NotificationSeverity } from 'src/entities/notification.entity';

export interface Presentation {
  category: NotificationCategory;
  icon: string;
  severity: NotificationSeverity;
  channels: Channel[];
}

/** Presentación por tipo de evento. La clave es el `type`. */
const CATALOG: Record<string, Partial<Presentation>> = {
  // ---- Soporte ----
  'ticket.creada':     { category: 'soporte', icon: 'life-buoy',     severity: 'info',    channels: ['bell', 'email', 'whatsapp'] },
  'ticket.asignado':   { category: 'soporte', icon: 'user-check',    severity: 'info',    channels: ['bell', 'email'] },
  'ticket.estado':     { category: 'soporte', icon: 'refresh-cw',    severity: 'info',    channels: ['bell', 'email'] },
  'ticket.comentario': { category: 'soporte', icon: 'message-square', severity: 'info',   channels: ['bell', 'email'] },
  'ticket.urgente':    { category: 'soporte', icon: 'alert-triangle', severity: 'warning', channels: ['whatsapp'] },
  // ---- Sesión ----
  'auth.login':        { category: 'sesion', icon: 'log-in',  severity: 'info', channels: ['bell'] },
  'auth.logout':       { category: 'sesion', icon: 'log-out', severity: 'info', channels: ['bell'] },
};

const DEFAULT_PRESENTATION: Presentation = {
  category: 'operacion',
  icon: 'bell',
  severity: 'info',
  channels: ['bell'],
};

export function resolvePresentation(
  type: string,
  overrides: { category?: NotificationCategory; icon?: string; severity?: NotificationSeverity; channels?: Channel[] } = {},
): Presentation {
  const base = CATALOG[type] ?? {};
  return {
    category: overrides.category ?? base.category ?? DEFAULT_PRESENTATION.category,
    icon: overrides.icon ?? base.icon ?? DEFAULT_PRESENTATION.icon,
    severity: overrides.severity ?? base.severity ?? DEFAULT_PRESENTATION.severity,
    channels: overrides.channels ?? base.channels ?? DEFAULT_PRESENTATION.channels,
  };
}

/**
 * Puente auditoría→notificación: convierte el módulo de auditoría (string del
 * enum AuditModule, p.ej. 'salidas_ruta') + acción en un `type` de notificación.
 * Para operaciones usamos `operacion.<modulo>` como tipo genérico; el catálogo
 * se enriquece por módulo en Task 8.
 */
export function auditToNotificationType(module: string, action?: string): string {
  if (module === 'auth' && (action === 'login' || action === 'logout')) return `auth.${action}`;
  return `operacion.${module}`;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/notifications/notification-catalog.spec.ts
import { resolvePresentation, auditToNotificationType } from './notification-catalog';

describe('notification-catalog', () => {
  it('returns catalog presentation for a known type', () => {
    const p = resolvePresentation('ticket.creada');
    expect(p.category).toBe('soporte');
    expect(p.channels).toEqual(['bell', 'email', 'whatsapp']);
  });

  it('falls back to operacion/bell for unknown types', () => {
    const p = resolvePresentation('operacion.consolidados');
    expect(p.category).toBe('operacion');
    expect(p.channels).toEqual(['bell']);
  });

  it('overrides win over catalog', () => {
    const p = resolvePresentation('ticket.creada', { channels: ['bell'] });
    expect(p.channels).toEqual(['bell']);
  });

  it('bridges auth login/logout and generic operations', () => {
    expect(auditToNotificationType('auth', 'login')).toBe('auth.login');
    expect(auditToNotificationType('salidas_ruta', 'create')).toBe('operacion.salidas_ruta');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- notification-catalog`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notification.types.ts src/notifications/notification-catalog.ts src/notifications/notification-catalog.spec.ts
git commit -m "feat(notifications): event catalog + audit->type bridge + shared types"
```

---

## Task 3: `emit()` — audience resolution + fan-out persistence

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Create: `src/notifications/emit.service.spec.ts`

**Interfaces:**
- Consumes: `Notification` entity, `NotificationEvent`, `Audience`, `resolvePresentation`.
- Produces:
  - `NotificationsService.resolveAudience(audience, excludeActorId?): Promise<string[]>`
  - `NotificationsService.emit(event: NotificationEvent): Promise<void>` (never throws)
  - constructor gains `@InjectRepository(Notification) notifRepo` and `@InjectRepository(User) userRepo`, plus `NotificationDispatchService` (Task 4 — inject now, call in Task 4).

- [ ] **Step 1: Write the failing test for audience resolution + fan-out**

```ts
// src/notifications/emit.service.spec.ts
import { NotificationsService } from './notifications.service';

function make(overrides: any = {}) {
  const saved: any[] = [];
  const notifRepo: any = {
    create: (d: any) => d,
    save: (rows: any[]) => { saved.push(...rows); return Promise.resolve(rows); },
  };
  const userRepo: any = {
    find: overrides.userFind ?? (() => Promise.resolve([{ id: 'u1' }, { id: 'u2' }, { id: 'actor' }])),
  };
  const readRepo: any = {};
  const auditRepo: any = {};
  const dispatch: any = { deliver: jest.fn(() => Promise.resolve()) };
  const svc = new NotificationsService(auditRepo, readRepo, notifRepo, userRepo, dispatch);
  return { svc, saved, dispatch, userRepo };
}

describe('NotificationsService.emit', () => {
  it('fans out a subsidiary broadcast to one row per user, excluding the actor', async () => {
    const { svc, saved } = make();
    await svc.emit({
      type: 'operacion.consolidados',
      audience: { subsidiaryId: 's1' },
      title: 'Consolidado',
      body: 'Registró consolidado C-1',
      actor: { id: 'actor', name: 'Ana' },
    });
    expect(saved.map((r) => r.recipientId).sort()).toEqual(['u1', 'u2']);
    expect(saved[0].type).toBe('operacion.consolidados');
    expect(saved[0].icon).toBe('bell'); // default presentation
  });

  it('targets a single user directly', async () => {
    const { svc, saved } = make();
    await svc.emit({ type: 'ticket.asignado', audience: { userId: 'dev1' }, title: 'Asignado' });
    expect(saved).toHaveLength(1);
    expect(saved[0].recipientId).toBe('dev1');
    expect(saved[0].category).toBe('soporte');
  });

  it('never throws even if persistence fails', async () => {
    const { svc } = make();
    (svc as any).notifRepo.save = () => Promise.reject(new Error('db down'));
    await expect(svc.emit({ type: 'x', audience: { userId: 'u1' }, title: 't' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- emit.service`
Expected: FAIL (constructor arity / `emit` undefined).

- [ ] **Step 3: Extend the service**

Add imports and constructor params at the top of `src/notifications/notifications.service.ts`:

```ts
import { Notification } from 'src/entities/notification.entity';
import { User } from 'src/entities/user.entity';
import { In } from 'typeorm';
import { NotificationEvent, Audience } from './notification.types';
import { resolvePresentation } from './notification-catalog';
import { NotificationDispatchService } from './notification-dispatch.service';
```

Update the constructor (keep the existing two repos, append three):

```ts
  constructor(
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(NotificationRead) private readonly readRepo: Repository<NotificationRead>,
    @InjectRepository(Notification) private readonly notifRepo: Repository<Notification>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dispatch: NotificationDispatchService,
  ) {}
```

Add the methods:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- emit.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/emit.service.spec.ts
git commit -m "feat(notifications): emit() with audience resolution and per-recipient fan-out"
```

---

## Task 4: Side-channel dispatch (email + WhatsApp), best-effort

**Files:**
- Create: `src/notifications/notification-dispatch.service.ts`
- Create: `src/notifications/notification-dispatch.service.spec.ts`

**Interfaces:**
- Consumes: `MailerService` (`@nestjs-modules/mailer`), `WhatsappGatewayService.sendText(phone, text)`, `User` repo (to look up emails/phones).
- Produces: `NotificationDispatchService.deliver(event, recipientIds, channels): Promise<void>` (never throws). Reads recipient email/phone from `User`. WhatsApp target for `soporte` events is the configured support phone (`SUPPORT_WHATSAPP` env); for others, recipient phones if present.

- [ ] **Step 1: Write the failing test**

```ts
// src/notifications/notification-dispatch.service.spec.ts
import { NotificationDispatchService } from './notification-dispatch.service';

function make() {
  const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
  const wa: any = { sendText: jest.fn(() => Promise.resolve({ ok: true })) };
  const userRepo: any = {
    find: () => Promise.resolve([{ id: 'u1', email: 'u1@x.com', name: 'Uno' }]),
  };
  const svc = new NotificationDispatchService(mailer, wa, userRepo);
  return { svc, mailer, wa };
}

describe('NotificationDispatchService.deliver', () => {
  it('sends email when channel includes email', async () => {
    const { svc, mailer } = make();
    await svc.deliver({ type: 'ticket.estado', audience: { userId: 'u1' }, title: 'Actualizado', body: 'Resuelto' } as any, ['u1'], ['bell', 'email']);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not send email when only bell', async () => {
    const { svc, mailer } = make();
    await svc.deliver({ type: 'operacion.x', audience: { subsidiaryId: 's' }, title: 't' } as any, ['u1'], ['bell']);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('never throws when a channel fails', async () => {
    const { svc, mailer } = make();
    mailer.sendMail = () => Promise.reject(new Error('smtp down'));
    await expect(svc.deliver({ type: 't', audience: { userId: 'u1' }, title: 't' } as any, ['u1'], ['email'])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- notification-dispatch`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the dispatch service**

```ts
// src/notifications/notification-dispatch.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { User } from 'src/entities/user.entity';
import { WhatsappGatewayService } from 'src/whatsapp-gateway/whatsapp-gateway.service';
import { Channel, NotificationEvent } from './notification.types';

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly whatsapp: WhatsappGatewayService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** Entrega canales laterales. Best-effort: cada canal aislado, jamás lanza. */
  async deliver(event: NotificationEvent, recipientIds: string[], channels: Channel[]): Promise<void> {
    const wantEmail = channels.includes('email');
    const wantWa = channels.includes('whatsapp');
    if (!wantEmail && !wantWa) return;

    let recipients: User[] = [];
    try {
      recipients = await this.userRepo.find({ where: { id: In(recipientIds) }, select: ['id', 'email', 'name'] });
    } catch (e: any) {
      this.logger.warn(`no se pudieron leer destinatarios: ${e?.message}`);
    }

    if (wantEmail) {
      const html = this.buildEmailHtml(event);
      for (const u of recipients) {
        if (!u.email) continue;
        try {
          await this.mailer.sendMail({ to: u.email, subject: event.title || 'Notificación PMY', html });
        } catch (e: any) {
          this.logger.warn(`email a ${u.email} falló: ${e?.message}`);
        }
      }
    }

    if (wantWa) {
      const phone = process.env.SUPPORT_WHATSAPP;
      if (phone) {
        try {
          await this.whatsapp.sendText(phone, `*${event.title ?? 'PMY'}*\n${event.body ?? ''}`.trim());
        } catch (e: any) {
          this.logger.warn(`whatsapp falló: ${e?.message}`);
        }
      }
    }
  }

  private buildEmailHtml(event: NotificationEvent): string {
    const link = event.link ? `${process.env.FRONTEND_URL ?? ''}${event.link}` : null;
    return `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <h2 style="margin:0 0 8px">${event.title ?? 'Notificación'}</h2>
        <p style="margin:0 0 16px;color:#475569">${event.body ?? ''}</p>
        ${link ? `<a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Abrir en PMY</a>` : ''}
        <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">PMY App · notificación automática</p>
      </div>`;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- notification-dispatch`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notification-dispatch.service.ts src/notifications/notification-dispatch.service.spec.ts
git commit -m "feat(notifications): best-effort email + WhatsApp dispatch service"
```

---

## Task 5: `emitFromAudit()` + interceptor wiring

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Modify: `src/audit/audit.interceptor.ts`
- Modify: `src/audit/audit.module.ts`

**Interfaces:**
- Consumes: `auditToNotificationType`, `emit`.
- Produces: `NotificationsService.emitFromAudit(input: AuditEmitInput): void` where
  `AuditEmitInput = { module: string; action?: string; title?: string; body?: string; entityId?: string; subsidiaryId?: string; actor?: { id?: string; name?: string }; isSession?: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/notifications/emit.service.spec.ts
describe('NotificationsService.emitFromAudit', () => {
  it('maps an operation to a subsidiary broadcast', async () => {
    const { svc, saved } = make();
    svc.emitFromAudit({
      module: 'consolidados', action: 'create', title: 'Consolidado',
      body: 'Registró consolidado C-1', entityId: 'c1', subsidiaryId: 's1',
      actor: { id: 'actor', name: 'Ana' },
    });
    await new Promise((r) => setTimeout(r, 0)); // emit is fire-and-forget
    expect(saved.every((r) => r.type === 'operacion.consolidados')).toBe(true);
    expect(saved.map((r) => r.recipientId).sort()).toEqual(['u1', 'u2']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- emit.service`
Expected: FAIL (`emitFromAudit` undefined).

- [ ] **Step 3: Implement `emitFromAudit`**

Add import at top of `notifications.service.ts`:

```ts
import { auditToNotificationType } from './notification-catalog';
```

Add the method:

```ts
  interface AuditEmitInput {
    module: string;
    action?: string;
    title?: string;
    body?: string;
    entityId?: string;
    subsidiaryId?: string;
    actor?: { id?: string; name?: string };
    isSession?: boolean;
  }

  /**
   * Puente desde el interceptor de auditoría. Fire-and-forget: construye un
   * NotificationEvent a partir del resultado ya calculado por resolveAudit().
   */
  emitFromAudit(input: AuditEmitInput): void {
    const type = auditToNotificationType(input.module, input.action);
    // Sesiones (login/logout) → superadmins; operaciones → sucursal del actor.
    const audience: Audience = input.isSession
      ? { role: 'superadmin' }
      : input.subsidiaryId
        ? { subsidiaryId: input.subsidiaryId, roles: ['admin', 'superadmin', 'subadmin', 'owner'] }
        : { role: 'superadmin' };
    void this.emit({
      type,
      audience,
      title: input.title ?? 'Actividad',
      body: input.body,
      entityId: input.entityId,
      subsidiaryId: input.subsidiaryId,
      actor: input.actor,
    });
  }
```

> **Note (`AuditEmitInput`):** declare this `interface` at module scope (top of the file, not inside the class). Shown here beside the method for readability only.

- [ ] **Step 4: Wire the interceptor**

In `src/audit/audit.interceptor.ts`, inject the service. Update constructor:

```ts
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}
```

Add import:

```ts
import { NotificationsService } from 'src/notifications/notifications.service';
```

Inside the `tap((response) => { ... })` success block, AFTER `this.audit.log({...})`, add:

```ts
        try {
          this.notifications.emitFromAudit({
            module: String(e.module),
            action: String(e.action),
            title: e.entityName ?? 'Actividad',
            body: e.description,
            entityId:
              meta?.resolveEntityId?.({ params: req.params, body: req.body, response }) ??
              req.params?.id ??
              (response && typeof response === 'object' ? response.id : undefined),
            subsidiaryId: base.subsidiaryId,
            actor: { id: base.userId, name: base.userName ?? base.userEmail },
            isSession: String(e.module) === 'auth',
          });
        } catch { /* best-effort: nunca romper la request */ }
```

- [ ] **Step 5: Make `NotificationsService` importable by the audit module**

In `src/audit/audit.module.ts`, add `NotificationsModule` to `imports`. In `src/notifications/notifications.module.ts`, add `NotificationsService` to `exports` (done in Task 6). Add import:

```ts
import { NotificationsModule } from 'src/notifications/notifications.module';
```

- [ ] **Step 6: Run tests + build**

Run: `npm test -- emit.service && npm run build`
Expected: tests PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/notifications/notifications.service.ts src/audit/audit.interceptor.ts src/audit/audit.module.ts
git commit -m "feat(notifications): bridge audit events into emit() from the interceptor"
```

---

## Task 6: Union feed + per-item read + module wiring

**Files:**
- Modify: `src/notifications/notifications.service.ts` (getFeed union, markOneRead)
- Modify: `src/notifications/notifications.controller.ts`
- Modify: `src/notifications/notifications.module.ts`

**Interfaces:**
- Consumes: existing `getFeed` (legacy audit-derived), `Notification` repo.
- Produces:
  - `getFeed(user, limit)` returns `{ items, unreadCount, lastReadAt }` where items merge real `Notification` rows (for `recipientId = user.userId`) + legacy audit-derived items, deduped by `entityId+type`, sorted by `createdAt` desc.
  - `markOneRead(userId, id): Promise<{ ok: boolean }>`
  - Controller route `POST /notifications/:id/read`.

- [ ] **Step 1: Write the failing test for per-item read**

```ts
// append to src/notifications/emit.service.spec.ts
describe('markOneRead', () => {
  it('marks a single notification read for its owner', async () => {
    const update = jest.fn(() => Promise.resolve({ affected: 1 }));
    const { svc } = make();
    (svc as any).notifRepo.update = update;
    const res = await svc.markOneRead('u1', 'n1');
    expect(update).toHaveBeenCalledWith({ id: 'n1', recipientId: 'u1' }, expect.objectContaining({ read: true }));
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- emit.service`
Expected: FAIL (`markOneRead` undefined).

- [ ] **Step 3: Implement `markOneRead` and the union feed**

Add to `NotificationsService`:

```ts
  async markOneRead(userId: string, id: string): Promise<{ ok: boolean }> {
    try {
      await this.notifRepo.update({ id, recipientId: userId }, { read: true, readAt: new Date() });
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`markOneRead degradado: ${e.message}`);
      return { ok: false };
    }
  }

  /** Notificaciones reales (nuevas) del usuario, mapeadas al shape del feed. */
  private async getRealFeed(userId: string, limit: number): Promise<NotificationItem[]> {
    const rows = await this.notifRepo.find({
      where: { recipientId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      module: r.category,
      actor: r.actorName ?? 'Sistema',
      actorEmail: undefined,
      message: r.body ?? r.title,
      entityId: r.entityId ?? undefined,
      subsidiaryId: r.subsidiaryId ?? undefined,
      read: r.read,
      kind: r.category === 'sesion' ? 'session' : 'operation',
      // extras para la campana enriquecida:
      title: r.title, icon: r.icon ?? undefined, link: r.link ?? undefined, severity: r.severity,
    }) as any);
  }
```

Rename the current body of `getFeed` to a private `getLegacyFeed(user, limit)` returning the same `{ items, unreadCount, lastReadAt }`, then add the union wrapper:

```ts
  async getFeed(user: any, limit = 30) {
    const [legacy, real] = await Promise.all([
      this.getLegacyFeed(user, limit).catch(() => ({ items: [], unreadCount: 0, lastReadAt: null })),
      this.getRealFeed(user.userId, limit).catch(() => [] as NotificationItem[]),
    ]);
    // Dedup por entityId+module para no duplicar durante la transición.
    const seen = new Set(real.map((r) => `${r.entityId ?? ''}:${r.module}`));
    const merged = [
      ...real,
      ...legacy.items.filter((l) => !seen.has(`${l.entityId ?? ''}:${l.module}`)),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const items = merged.slice(0, limit);
    const unreadCount = real.filter((r) => !r.read).length + legacy.unreadCount;
    return { items, unreadCount, lastReadAt: legacy.lastReadAt };
  }
```

> When the cutover flag `NOTIFICATIONS_LEGACY_FEED=false` is set (Task 8), skip `getLegacyFeed` entirely and return only `real`.

- [ ] **Step 4: Add the controller route**

In `notifications.controller.ts` add:

```ts
  @NoAudit()
  @Post(':id/read')
  markOne(@Request() req, @Param('id') id: string) {
    return this.notifications.markOneRead(req.user?.userId, id);
  }
```

Add `Param` to the `@nestjs/common` import.

- [ ] **Step 5: Wire the module**

Replace `notifications.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from 'src/entities/audit-log.entity';
import { NotificationRead } from 'src/entities/notification-read.entity';
import { Notification } from 'src/entities/notification.entity';
import { User } from 'src/entities/user.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationDispatchService } from './notification-dispatch.service';
import { WhatsappGatewayModule } from 'src/whatsapp-gateway/whatsapp-gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, NotificationRead, Notification, User]),
    WhatsappGatewayModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationDispatchService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

> Verify `WhatsappGatewayModule` exports `WhatsappGatewayService`. If it does not, add `exports: [WhatsappGatewayService]` to that module.

- [ ] **Step 6: Run tests + build**

Run: `npm test -- emit.service && npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/notifications/
git commit -m "feat(notifications): union feed (real + legacy), per-item read, module wiring"
```

---

## Task 7: Retention cron job

**Files:**
- Create: `src/notifications/notifications.retention.ts`
- Modify: `src/notifications/notifications.module.ts` (register provider)

**Interfaces:**
- Consumes: `Notification` repo, `@nestjs/schedule` `@Cron`.
- Produces: `NotificationsRetentionService` that daily deletes `read = true AND createdAt < now - RETENTION_DAYS` (default 90).

- [ ] **Step 1: Implement the job**

```ts
// src/notifications/notifications.retention.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Notification } from 'src/entities/notification.entity';

@Injectable()
export class NotificationsRetentionService {
  private readonly logger = new Logger(NotificationsRetentionService.name);
  constructor(@InjectRepository(Notification) private readonly repo: Repository<Notification>) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune() {
    const days = Number(process.env.NOTIFICATIONS_RETENTION_DAYS ?? 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const res = await this.repo.delete({ read: true, createdAt: LessThan(cutoff) });
      this.logger.log(`Poda de notificaciones: ${res.affected ?? 0} filas (> ${days} días, leídas).`);
    } catch (e: any) {
      this.logger.warn(`Poda de notificaciones falló: ${e?.message}`);
    }
  }
}
```

- [ ] **Step 2: Register the provider**

Add `NotificationsRetentionService` to the `providers` array in `notifications.module.ts` and its import. (`ScheduleModule.forRoot()` is already in `app.module.ts`.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/notifications/notifications.retention.ts src/notifications/notifications.module.ts
git commit -m "feat(notifications): daily retention job for read notifications"
```

---

## Task 8: DB migration, event enrichment, and cutover flag

**Files:**
- Create: `src/database/migrations/<timestamp>-CreateNotification.ts`
- Modify: `src/notifications/notification-catalog.ts` (enrich operational types)
- Modify: `src/notifications/notifications.service.ts` (respect `NOTIFICATIONS_LEGACY_FEED`)

**Interfaces:**
- Produces: `notification` table migration; enriched catalog entries for live operational modules.

- [ ] **Step 1: Generate the migration**

Run: `npm run typeorm -- migration:generate src/database/migrations/CreateNotification -d <datasource>`
(Match the project's existing migration command — see `package.json` scripts and the newest file under `src/database/migrations/`. If the repo hand-writes migrations, copy that style: `CREATE TABLE notification (...)` with the columns from Task 1 and the two indexes.)
Expected: a migration file creating `notification` with indexes `(recipientId, read)` and `(recipientId, createdAt)`.

- [ ] **Step 2: Enrich operational event types**

In `notification-catalog.ts`, add entries so the live modules get proper icon/audience/link. Example additions to `CATALOG`:

```ts
  'operacion.salidas_ruta': { category: 'operacion', icon: 'truck',      severity: 'info', channels: ['bell'] },
  'operacion.desembarques': { category: 'operacion', icon: 'package-open', severity: 'info', channels: ['bell'] },
  'operacion.consolidados': { category: 'operacion', icon: 'boxes',      severity: 'info', channels: ['bell'] },
  'operacion.devoluciones': { category: 'operacion', icon: 'undo-2',     severity: 'info', channels: ['bell'] },
  'operacion.recolecciones':{ category: 'operacion', icon: 'hand',       severity: 'info', channels: ['bell'] },
  'operacion.inventarios':  { category: 'operacion', icon: 'clipboard-list', severity: 'info', channels: ['bell'] },
  'operacion.cierre_ruta':  { category: 'operacion', icon: 'flag',       severity: 'info', channels: ['bell'] },
  'operacion.traslados':    { category: 'operacion', icon: 'arrow-left-right', severity: 'info', channels: ['bell'] },
  'operacion.gastos':       { category: 'operacion', icon: 'receipt',    severity: 'info', channels: ['bell'] },
```

(Icons are lucide names the frontend maps in Plan 2.)

- [ ] **Step 3: Add the cutover guard to the feed**

In `getFeed`, gate the legacy branch:

```ts
    const legacyEnabled = process.env.NOTIFICATIONS_LEGACY_FEED !== 'false';
    const [legacy, real] = await Promise.all([
      legacyEnabled ? this.getLegacyFeed(user, limit).catch(() => ({ items: [], unreadCount: 0, lastReadAt: null }))
                    : Promise.resolve({ items: [], unreadCount: 0, lastReadAt: null }),
      this.getRealFeed(user.userId, limit).catch(() => [] as NotificationItem[]),
    ]);
```

- [ ] **Step 4: Verify end-to-end manually**

Run the API with `DB_SYNC=true` (dev). Perform a mutation (e.g., create a consolidado). Then `GET /api/notifications` as a user of that subsidiary.
Expected: a real notification row appears (icon `boxes`), no duplicate legacy item for the same event.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/ src/notifications/notification-catalog.ts src/notifications/notifications.service.ts
git commit -m "feat(notifications): migration, enriched operational catalog, cutover flag"
```

- [ ] **Step 6: Refresh the code graph**

Run: `graphify update .`

---

## Self-Review Notes (author)

- **Spec coverage:** entity §3.1 → T1; emit/audience §3.2 → T3; catalog §3.3 → T2/T8; interceptor bridge §3.4 → T5; feed union + per-item read + cutover §3.5 → T6/T8; retention §3.1 → T7. Support-specific `emit()` calls live in Plan 2.
- **Type consistency:** `emit(NotificationEvent)`, `resolveAudience(Audience, excludeActorId?)`, `emitFromAudit(AuditEmitInput)`, `markOneRead(userId,id)`, `deliver(event, recipientIds, channels)` — names are referenced identically across tasks.
- **Cutover safety:** legacy feed stays on until `NOTIFICATIONS_LEGACY_FEED=false`; dedup prevents doubles meanwhile.
