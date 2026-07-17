# Notificaciones — Finalización de plantillas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminar las notificaciones del branch: correos con asuntos descriptivos + seguimiento + link al sistema, y WhatsApp con varias plantillas configurables cuyo número destino se elige al enviar.

**Architecture:** Backend `pmy-api` (NestJS + TypeORM/MySQL): se enriquecen los seeds de correo y `MailService`, se crea la tabla `whatsapp_templates` con CRUD y seed, y se limpia `whatsapp_settings`/`/whatsapp/send`. Frontend `app-pmy` (Next.js App Router): gestor de plantillas en Configuración, componente reutilizable `EnviarNotificacion` con selector de número, y foco por `?seguimiento=` en las listas.

**Tech Stack:** NestJS, TypeORM (MySQL, migraciones SQL crudas en `src/database/migrations/`), Handlebars (motor de plantillas), Jest. Frontend: Next.js, React, TypeScript.

## Global Constraints

- Base de datos MySQL; cambios de esquema van en `src/database/migrations/NNNN-Nombre.ts` (SQL crudo, idempotente, con `down`). Timestamp de migración > `1786000000033`.
- Los seeds son **idempotentes por clave** y NO deben pisar ediciones del usuario (patrón: solo refrescar si `changelog`/estado sigue siendo el del seed, o insertar si falta).
- TZ de negocio: `America/Hermosillo`. Fechas de correo via helper `formatDate`.
- Correos: el motor aplana `data` y expone `{{system.appUrl}}`; los bloques soportan `when: '<var>'`.
- No romper migraciones históricas: `whatsapp-defaults.ts` (`DEFAULT_DRIVER_PHONE`, `DEFAULT_MESSAGE_TEMPLATE`) es importado por `1786000000027-AddWhatsappSettings.ts` → **no borrar ese archivo ni esas constantes**.
- `FRONTEND_URL` (fallback `https://app-pmy.vercel.app`) es la base de los links de correo.
- Commits frecuentes, uno por tarea. Mensajes en español, sin `--no-verify`.

---

## Fase A — Correos (pmy-api)

### Task A1: Asuntos + variable `detailLink` + seguimiento en cierre (seed de correos)

**Files:**
- Modify: `src/documents/seeds/email-templates.seed.ts`
- Test: `src/documents/seeds/email-templates.seed.spec.ts`

**Interfaces:**
- Produces: cada `EmailSeed` de reporte declara la variable `detailLink` y (donde aplica) un bloque `button` `{ type:'button', text:'Ver en el sistema', url:'{{detailLink}}', when:'detailLink' }`. `route_dispatch.subject` incluye `{{subsidiaryName}}`. `route_closure` declara variable `trackingNumber` + fila keyValue "Seguimiento".

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/documents/seeds/email-templates.seed.spec.ts`:

```ts
import { EMAIL_TEMPLATE_SEEDS } from './email-templates.seed';

const byCode = (c: string) => EMAIL_TEMPLATE_SEEDS.find((s) => s.code === c)!;

describe('EMAIL_TEMPLATE_SEEDS — asuntos y link al sistema', () => {
  const reportCodes = ['route_dispatch', 'unloading', 'route_closure', 'inventory', 'devolutions', 'dex03_report'];

  it('route_dispatch incluye chofer y sucursal en el asunto', () => {
    expect(byCode('route_dispatch').subject).toContain('{{driverName}}');
    expect(byCode('route_dispatch').subject).toContain('{{subsidiaryName}}');
  });

  it('todos los reportes declaran la variable detailLink', () => {
    for (const code of reportCodes) {
      const seed = byCode(code);
      expect(seed.variables.some((v) => v.name === 'detailLink')).toBe(true);
    }
  });

  it('todos los reportes tienen un botón "Ver en el sistema" condicionado a detailLink', () => {
    for (const code of reportCodes) {
      const btn = byCode(code).blocks.find((b: any) => b.type === 'button' && b.when === 'detailLink');
      expect(btn, `falta botón en ${code}`).toBeTruthy();
      expect((btn as any).url).toBe('{{detailLink}}');
    }
  });

  it('cierre de ruta declara y muestra el número de seguimiento', () => {
    const seed = byCode('route_closure');
    expect(seed.variables.some((v) => v.name === 'trackingNumber')).toBe(true);
    const kv = seed.blocks.find((b: any) => b.type === 'keyValue') as any;
    expect(kv.items.some((i: any) => i.value === '{{trackingNumber}}')).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx jest src/documents/seeds/email-templates.seed.spec.ts -t "asuntos y link"`
Expected: FAIL (falta `subsidiaryName` en subject, falta `detailLink`, falta botón, falta seguimiento en closure).

- [ ] **Step 3: Editar el seed**

En `src/documents/seeds/email-templates.seed.ts`:

1. `route_dispatch.subject` →
```ts
subject: '🚚 Salida a Ruta - {{driverName}} - {{subsidiaryName}} - {{formatDate createdAt}}',
```
2. `route_closure.subject` →
```ts
subject: '🚚 Cierre de Ruta - {{driverName}} - {{subsidiaryName}} - {{formatDate createdAt}}',
```
3. `inventory.subject` →
```ts
subject: '📦 Inventario - {{subsidiaryName}} - {{formatDate inventoryDate}}',
```
4. `devolutions.subject` →
```ts
subject: '🔄 Devoluciones/Recolecciones - {{subsidiaryName}} - {{formatDate createdAt}}',
```
5. En `route_closure.blocks`, agregar bloque keyValue con seguimiento (después del párrafo):
```ts
{ id: 'kv', type: 'keyValue', items: [
  { label: 'Fecha y hora', value: '{{formatDate createdAt}}' },
  { label: 'Chofer', value: '{{driverName}}' },
  { label: 'Seguimiento', value: '{{trackingNumber}}' },
] },
```
   y a `route_closure.variables` agregar `{ name: 'trackingNumber', label: 'Número de seguimiento' }`.
6. En **cada** seed de reporte (`route_dispatch`, `unloading`, `route_closure`, `inventory`, `devolutions`, `dex03_report`), agregar como **último** bloque:
```ts
{ id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
```
   y a sus `variables` agregar `{ name: 'detailLink', label: 'Enlace al sistema' }`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx jest src/documents/seeds/email-templates.seed.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/documents/seeds/email-templates.seed.ts src/documents/seeds/email-templates.seed.spec.ts
git commit -m "feat(documents): asuntos descriptivos + link al sistema + seguimiento en cierre (seed correos)"
```

---

### Task A2: `MailService` compone `detailLink` y pasa seguimiento de cierre

**Files:**
- Modify: `src/mail/mail.service.ts`
- Test: `src/mail/mail.service.spec.ts`

**Interfaces:**
- Consumes: `TemplateService.render(code, data)` (ya existente).
- Produces: método privado `buildDetailLink(path: string, tracking?: string): string`; cada método de envío de reporte agrega `detailLink` (y `route_closure` agrega `trackingNumber`) al objeto `data` pasado a `render`.

- [ ] **Step 1: Escribir el test que falla**

Crear/append `src/mail/mail.service.spec.ts`. Mockear `MailerService`, `ConfigService`, y `TemplateService` (capturando el `data` recibido):

```ts
import { Test } from '@nestjs/testing';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { TemplateService } from 'src/documents/template.service';

describe('MailService — detailLink', () => {
  let mail: MailService;
  let render: jest.Mock;

  beforeEach(async () => {
    process.env.FRONTEND_URL = 'https://app.example.com/';
    render = jest.fn().mockResolvedValue({ subject: 's', html: '<p>h</p>' });
    const mod = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailerService, useValue: { sendMail: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: () => 'production' } },
        { provide: TemplateService, useValue: { render } },
      ],
    }).compile();
    mail = mod.get(MailService);
  });

  it('desembarque manda detailLink a /operaciones/desembarques con seguimiento', async () => {
    const unloading: any = {
      subsidiary: { officeEmail: 'a@b.com', officeEmailToCopy: 'c@d.com' },
      vehicle: { name: 'U1' }, createdAt: new Date(), trackingNumber: 'ABC123',
    };
    const file: any = { originalname: 'a.pdf', buffer: Buffer.from('') };
    await mail.sendHighPriorityUnloadingEmail(file, file, 'SUC', unloading);
    const data = render.mock.calls[0][1];
    expect(data.detailLink).toBe('https://app.example.com/operaciones/desembarques?seguimiento=ABC123');
  });

  it('cierre de ruta manda trackingNumber y detailLink a salidas-a-ruta', async () => {
    const rc: any = {
      subsidiary: { name: 'SUC', officeEmail: 'a@b.com', officeEmailToCopy: 'c@d.com' },
      packageDispatch: { drivers: [{ name: 'Juan' }], trackingNumber: 'RC9' },
    };
    const file: any = { originalname: 'a.pdf', buffer: Buffer.from('') };
    await mail.sendHighPriorityRouteClosureEmail(file, file, rc);
    const data = render.mock.calls[0][1];
    expect(data.trackingNumber).toBe('RC9');
    expect(data.detailLink).toBe('https://app.example.com/operaciones/salidas-a-ruta?seguimiento=RC9');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx jest src/mail/mail.service.spec.ts -t "detailLink"`
Expected: FAIL (`data.detailLink` undefined).

- [ ] **Step 3: Implementar en `mail.service.ts`**

Agregar el helper privado:

```ts
/** Base del frontend sin barra final, para componer links de correo. */
private detailBase(): string {
  return (this.configService.get<string>('FRONTEND_URL') ?? 'https://app-pmy.vercel.app').replace(/\/+$/, '');
}

/** Link "ver en el sistema": ruta de módulo + ?seguimiento= (si hay guía). */
private buildDetailLink(path: string, tracking?: string): string {
  const url = `${this.detailBase()}${path}`;
  return tracking ? `${url}?seguimiento=${encodeURIComponent(tracking)}` : url;
}
```

Agregar `detailLink` a cada `render(...)` de reporte:

- `route_dispatch` (`sendHighPriorityPackageDispatchEmail`):
```ts
detailLink: this.buildDetailLink('/operaciones/salidas-a-ruta', packageDispatch.trackingNumber),
```
- `unloading` (`sendHighPriorityUnloadingEmail`):
```ts
detailLink: this.buildDetailLink('/operaciones/desembarques', unloading.trackingNumber),
```
- `inventory` (`sendHighPriorityInventoryEmail`):
```ts
detailLink: this.buildDetailLink('/operaciones/inventarios', inventory.trackingNumber),
```
- `devolutions` (`sendHighPriorityDevolutionsEmail`):
```ts
detailLink: this.buildDetailLink('/operaciones/devoluciones'),
```
- `dex03_report` (`sendHighPriorityShipmentWithStatus03`):
```ts
detailLink: this.buildDetailLink('/reportes'),
```
- `route_closure` (`sendHighPriorityRouteClosureEmail`): agregar dos campos al `render`:
```ts
trackingNumber: routeClosure.packageDispatch?.trackingNumber,
detailLink: this.buildDetailLink('/operaciones/salidas-a-ruta', routeClosure.packageDispatch?.trackingNumber),
```

> Nota: `applyDevFilters` usa `NODE_ENV === 'dev'`; el mock de `ConfigService.get` devuelve `'production'` salvo la clave `FRONTEND_URL`. Si tu implementación lee `FRONTEND_URL` por `process.env`, mantenerlo; el test setea ambas vías (`process.env.FRONTEND_URL`). Usa `process.env.FRONTEND_URL` en `detailBase()` si el `ConfigService` del proyecto no lo expone.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx jest src/mail/mail.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mail/mail.service.ts src/mail/mail.service.spec.ts
git commit -m "feat(mail): componer detailLink por reporte y pasar seguimiento en cierre de ruta"
```

---

## Fase B — Tabla `whatsapp_templates` (pmy-api)

### Task B1: Entidad `WhatsappTemplate` + defaults

**Files:**
- Create: `src/entities/whatsapp-template.entity.ts`
- Create: `src/whatsapp-templates/whatsapp-template-defaults.ts`
- Modify: `src/entities/index.ts`
- Test: `src/whatsapp-templates/whatsapp-template-defaults.spec.ts`

**Interfaces:**
- Produces:
  - `WhatsappTemplate { id:string; key:string; name:string; body:string; active:boolean; updatedAt:Date }`
  - `WHATSAPP_TEMPLATE_DEFAULTS: { key:string; name:string; body:string }[]` con claves `prioridad_entrega`, `salida_ruta`, `desembarque`, `inventario`, `reporte`.

- [ ] **Step 1: Escribir el test que falla**

`src/whatsapp-templates/whatsapp-template-defaults.spec.ts`:

```ts
import { WHATSAPP_TEMPLATE_DEFAULTS } from './whatsapp-template-defaults';

describe('WHATSAPP_TEMPLATE_DEFAULTS', () => {
  it('incluye las 5 plantillas con claves únicas', () => {
    const keys = WHATSAPP_TEMPLATE_DEFAULTS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['prioridad_entrega', 'salida_ruta', 'desembarque', 'inventario', 'reporte']));
  });

  it('las de evento incluyen {link} y {sucursal}', () => {
    for (const key of ['salida_ruta', 'desembarque', 'inventario', 'reporte']) {
      const t = WHATSAPP_TEMPLATE_DEFAULTS.find((x) => x.key === key)!;
      expect(t.body).toContain('{link}');
      expect(t.body).toContain('{sucursal}');
    }
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/whatsapp-templates/whatsapp-template-defaults.spec.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Crear defaults y entidad**

`src/whatsapp-templates/whatsapp-template-defaults.ts`:

```ts
import { DEFAULT_MESSAGE_TEMPLATE } from '../whatsapp-settings/whatsapp-defaults';

/**
 * Plantillas de WhatsApp por defecto. Placeholders soportados (el frontend los
 * reemplaza antes de enviar): {sucursal} {chofer} {fecha} {seguimiento} {link}
 * {ruta} {unidad} {cliente} {direccion} {cp} {guias} {vence}.
 */
export const WHATSAPP_TEMPLATE_DEFAULTS: { key: string; name: string; body: string }[] = [
  { key: 'prioridad_entrega', name: 'Prioridad de entrega (Local Delay)', body: DEFAULT_MESSAGE_TEMPLATE },
  { key: 'salida_ruta', name: 'Salida a Ruta', body:
`🚚 *Salida a Ruta* — {sucursal}
Chofer: {chofer}
Fecha: {fecha}
Ruta(s): {ruta}
Seguimiento: {seguimiento}
Ver en el sistema: {link}` },
  { key: 'desembarque', name: 'Desembarque', body:
`📦 *Desembarque* — {sucursal}
Unidad: {unidad}
Fecha: {fecha}
Seguimiento: {seguimiento}
Ver en el sistema: {link}` },
  { key: 'inventario', name: 'Inventario', body:
`📋 *Inventario* — {sucursal}
Fecha: {fecha}
Seguimiento: {seguimiento}
Ver en el sistema: {link}` },
  { key: 'reporte', name: 'Reporte', body:
`📄 *Reporte* — {sucursal}
Fecha: {fecha}
Ver en el sistema: {link}` },
];
```

`src/entities/whatsapp-template.entity.ts`:

```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Plantilla de mensaje de WhatsApp editable desde Configuración. El número
 *  destino NO vive aquí: se elige al enviar (custom / chofer / encargado). */
@Entity('whatsapp_templates')
export class WhatsappTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Clave estable para buscar la plantilla (ej. 'salida_ruta'). */
  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  /** Cuerpo con placeholders {…} que el frontend reemplaza. */
  @Column({ type: 'text' })
  body: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;
}
```

Registrar en `src/entities/index.ts` (seguir el patrón de export existente):
```ts
export * from './whatsapp-template.entity';
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/whatsapp-templates/whatsapp-template-defaults.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/whatsapp-template.entity.ts src/whatsapp-templates/whatsapp-template-defaults.ts src/entities/index.ts src/whatsapp-templates/whatsapp-template-defaults.spec.ts
git commit -m "feat(whatsapp): entidad WhatsappTemplate + plantillas por defecto"
```

---

### Task B2: `WhatsappTemplatesService` + seed idempotente

**Files:**
- Create: `src/whatsapp-templates/whatsapp-templates.service.ts`
- Create: `src/whatsapp-templates/whatsapp-templates.seed.ts`
- Test: `src/whatsapp-templates/whatsapp-templates.service.spec.ts`

**Interfaces:**
- Consumes: `WhatsappTemplate`, `WHATSAPP_TEMPLATE_DEFAULTS`.
- Produces:
  - `WhatsappTemplatesService` con: `list(): Promise<WhatsappTemplate[]>`, `getByKey(key): Promise<WhatsappTemplate|null>`, `create(dto: Partial<WhatsappTemplate>)`, `update(id: string, dto: Partial<WhatsappTemplate>)`, `remove(id: string): Promise<void>`.
  - `seedWhatsappTemplates(repo: Repository<WhatsappTemplate>): Promise<void>` (inserta solo claves faltantes).

- [ ] **Step 1: Escribir el test que falla**

`src/whatsapp-templates/whatsapp-templates.service.spec.ts` (mock de repo tipo array, patrón simple):

```ts
import { WhatsappTemplatesService } from './whatsapp-templates.service';

function makeRepoMock(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    find: jest.fn().mockImplementation(async () => rows),
    findOne: jest.fn().mockImplementation(async ({ where }: any) => rows.find((r) => r.key === where.key || r.id === where.id) ?? null),
    create: jest.fn().mockImplementation((x: any) => ({ ...x })),
    save: jest.fn().mockImplementation(async (x: any) => { if (!x.id) x.id = 'id-' + rows.length; const i = rows.findIndex((r) => r.id === x.id); if (i >= 0) rows[i] = x; else rows.push(x); return x; }),
    delete: jest.fn().mockImplementation(async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
  } as any;
}

describe('WhatsappTemplatesService', () => {
  it('update sella updatedAt y persiste el body', async () => {
    const repo = makeRepoMock([{ id: 'a', key: 'x', name: 'X', body: 'old', active: true }]);
    const svc = new WhatsappTemplatesService(repo);
    const r = await svc.update('a', { body: 'new' });
    expect(r.body).toBe('new');
    expect(r.updatedAt).toBeInstanceOf(Date);
  });
});
```

`src/whatsapp-templates/whatsapp-templates.seed.spec.ts`:

```ts
import { seedWhatsappTemplates } from './whatsapp-templates.seed';
import { WHATSAPP_TEMPLATE_DEFAULTS } from './whatsapp-template-defaults';

describe('seedWhatsappTemplates', () => {
  it('inserta claves faltantes y no duplica existentes', async () => {
    const rows: any[] = [{ id: 'pe', key: 'prioridad_entrega', name: 'x', body: 'EDITADO', active: true }];
    const repo: any = {
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => { x.id = x.id ?? 'n' + rows.length; rows.push(x); return x; }),
    };
    await seedWhatsappTemplates(repo);
    // no pisó la editada
    expect(rows.find((r) => r.key === 'prioridad_entrega').body).toBe('EDITADO');
    // insertó las otras 4
    expect(rows.length).toBe(WHATSAPP_TEMPLATE_DEFAULTS.length);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/whatsapp-templates/whatsapp-templates.service.spec.ts src/whatsapp-templates/whatsapp-templates.seed.spec.ts`
Expected: FAIL (módulos no existen).

- [ ] **Step 3: Implementar service y seed**

`src/whatsapp-templates/whatsapp-templates.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappTemplate } from 'src/entities';

@Injectable()
export class WhatsappTemplatesService {
  constructor(
    @InjectRepository(WhatsappTemplate) private readonly repo: Repository<WhatsappTemplate>,
  ) {}

  list() {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  getByKey(key: string) {
    return this.repo.findOne({ where: { key } });
  }

  create(dto: Partial<WhatsappTemplate>) {
    return this.repo.save(this.repo.create({ ...dto, updatedAt: new Date() }));
  }

  async update(id: string, dto: Partial<WhatsappTemplate>) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Plantilla no encontrada.');
    const { id: _omit, ...rest } = dto as any;
    Object.assign(row, rest);
    row.updatedAt = new Date();
    return this.repo.save(row);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
```

`src/whatsapp-templates/whatsapp-templates.seed.ts`:

```ts
import { Repository } from 'typeorm';
import { WhatsappTemplate } from 'src/entities';
import { WHATSAPP_TEMPLATE_DEFAULTS } from './whatsapp-template-defaults';

/** Inserta solo las claves que falten (no pisa ediciones del usuario). */
export async function seedWhatsappTemplates(repo: Repository<WhatsappTemplate>): Promise<void> {
  for (const def of WHATSAPP_TEMPLATE_DEFAULTS) {
    const existing = await repo.findOne({ where: { key: def.key } });
    if (!existing) {
      await repo.save(repo.create({ key: def.key, name: def.name, body: def.body, active: true, updatedAt: new Date() }));
    }
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/whatsapp-templates/whatsapp-templates.service.spec.ts src/whatsapp-templates/whatsapp-templates.seed.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-templates/whatsapp-templates.service.ts src/whatsapp-templates/whatsapp-templates.seed.ts src/whatsapp-templates/whatsapp-templates.service.spec.ts src/whatsapp-templates/whatsapp-templates.seed.spec.ts
git commit -m "feat(whatsapp): servicio CRUD + seed idempotente de plantillas"
```

---

### Task B3: Controller + módulo + enganche del seed

**Files:**
- Create: `src/whatsapp-templates/whatsapp-templates.controller.ts`
- Create: `src/whatsapp-templates/whatsapp-templates.module.ts`
- Modify: `src/app.module.ts` (importar `WhatsappTemplatesModule`)
- Modify: `src/seed/seed.ts` (llamar `seedWhatsappTemplates`)
- Test: `src/whatsapp-templates/whatsapp-templates.controller.spec.ts`

**Interfaces:**
- Consumes: `WhatsappTemplatesService`.
- Produces: `WhatsappTemplatesController` en ruta `whatsapp-templates` — `GET` (autenticado), `POST`/`PUT/:id`/`DELETE/:id` (AdminGuard). `WhatsappTemplatesModule` exporta `WhatsappTemplatesService`.

- [ ] **Step 1: Escribir el test que falla**

`src/whatsapp-templates/whatsapp-templates.controller.spec.ts`:

```ts
import { WhatsappTemplatesController } from './whatsapp-templates.controller';

describe('WhatsappTemplatesController', () => {
  const svc: any = {
    list: jest.fn().mockResolvedValue([{ key: 'salida_ruta' }]),
    create: jest.fn().mockResolvedValue({ id: '1' }),
    update: jest.fn().mockResolvedValue({ id: '1', body: 'b' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const ctrl = new WhatsappTemplatesController(svc);

  it('GET delega en list', async () => {
    expect(await ctrl.list()).toEqual([{ key: 'salida_ruta' }]);
  });
  it('PUT delega en update con id y body', async () => {
    await ctrl.update('1', { body: 'b' } as any);
    expect(svc.update).toHaveBeenCalledWith('1', { body: 'b' });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/whatsapp-templates/whatsapp-templates.controller.spec.ts`
Expected: FAIL (no existe el controller).

- [ ] **Step 3: Implementar controller y módulo**

`src/whatsapp-templates/whatsapp-templates.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { WhatsappTemplate } from 'src/entities';

@ApiTags('whatsapp-templates')
@ApiBearerAuth()
@Controller('whatsapp-templates')
export class WhatsappTemplatesController {
  constructor(private readonly service: WhatsappTemplatesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: Partial<WhatsappTemplate>) {
    return this.service.create(dto);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: Partial<WhatsappTemplate>) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

`src/whatsapp-templates/whatsapp-templates.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappTemplate } from 'src/entities';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WhatsappTemplate])],
  controllers: [WhatsappTemplatesController],
  providers: [WhatsappTemplatesService],
  exports: [WhatsappTemplatesService],
})
export class WhatsappTemplatesModule {}
```

En `src/app.module.ts`: importar y agregar `WhatsappTemplatesModule` al array `imports` (junto a los demás módulos).

En `src/seed/seed.ts`: tras los seeds existentes, agregar (usando el DataSource/repo ya disponible en ese archivo):
```ts
import { WhatsappTemplate } from 'src/entities';
import { seedWhatsappTemplates } from 'src/whatsapp-templates/whatsapp-templates.seed';
// ...
await seedWhatsappTemplates(dataSource.getRepository(WhatsappTemplate));
```
(Adaptar `dataSource` al nombre real de la variable de conexión en `seed.ts`.)

- [ ] **Step 4: Correr y verificar que pasa + compila**

Run: `npx jest src/whatsapp-templates/whatsapp-templates.controller.spec.ts && npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-templates/ src/app.module.ts src/seed/seed.ts
git commit -m "feat(whatsapp): controller REST de plantillas + módulo + enganche del seed"
```

---

## Fase C — `whatsapp_settings` y `/whatsapp/send` (pmy-api)

### Task C1: Migración — crear `whatsapp_templates`, migrar mensaje y soltar columnas

**Files:**
- Create: `src/database/migrations/1786000000034-WhatsappTemplatesAndSettingsCleanup.ts`
- Modify: `src/entities/whatsapp-settings.entity.ts` (quitar `driverPhone`, `messageTemplate`)
- Modify: `src/whatsapp-settings/whatsapp-settings.service.ts` (quitar defaults/normalización)
- Test: (verificación por compilación + `migration:run` en local)

**Interfaces:**
- Produces: tabla `whatsapp_templates` en BD; `whatsapp_settings` sin `driverPhone`/`messageTemplate`; `WhatsappSettings` entity = `{ id, enabled, updatedAt }`.

- [ ] **Step 1: Escribir la migración**

`src/database/migrations/1786000000034-WhatsappTemplatesAndSettingsCleanup.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { WHATSAPP_TEMPLATE_DEFAULTS } from '../../whatsapp-templates/whatsapp-template-defaults';

/**
 * Crea whatsapp_templates y siembra las plantillas por defecto. Migra el
 * messageTemplate editado (si existe) a 'prioridad_entrega'. Luego elimina las
 * columnas driverPhone/messageTemplate de whatsapp_settings (el número ahora se
 * elige al enviar).
 */
export class WhatsappTemplatesAndSettingsCleanup1786000000034 implements MigrationInterface {
  name = 'WhatsappTemplatesAndSettingsCleanup1786000000034';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`whatsapp_templates\` (
        \`id\`        VARCHAR(36)  NOT NULL,
        \`key\`       VARCHAR(64)  NOT NULL,
        \`name\`      VARCHAR(191) NOT NULL,
        \`body\`      TEXT         NOT NULL,
        \`active\`    TINYINT(1)   NOT NULL DEFAULT 1,
        \`updatedAt\` DATETIME     NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_whatsapp_templates_key\` (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Migrar el mensaje editado (si la columna aún existe) a 'prioridad_entrega'.
    let editedBody: string | null = null;
    try {
      const rows: any[] = await q.query(`SELECT \`messageTemplate\` AS b FROM \`whatsapp_settings\` LIMIT 1`);
      editedBody = rows?.[0]?.b ?? null;
    } catch { /* columna ya no existe: ok */ }

    for (const def of WHATSAPP_TEMPLATE_DEFAULTS) {
      const exists: any[] = await q.query(`SELECT id FROM \`whatsapp_templates\` WHERE \`key\` = ?`, [def.key]);
      if (exists.length) continue;
      const body = def.key === 'prioridad_entrega' && editedBody ? editedBody : def.body;
      await q.query(
        `INSERT INTO \`whatsapp_templates\` (\`id\`, \`key\`, \`name\`, \`body\`, \`active\`, \`updatedAt\`) VALUES (?, ?, ?, ?, 1, NOW())`,
        [randomUUID(), def.key, def.name, body],
      );
    }

    // Soltar columnas obsoletas de whatsapp_settings (tolerante si ya no están).
    for (const col of ['driverPhone', 'messageTemplate']) {
      try { await q.query(`ALTER TABLE \`whatsapp_settings\` DROP COLUMN \`${col}\``); } catch { /* ya eliminada */ }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`whatsapp_settings\` ADD COLUMN \`driverPhone\` VARCHAR(30) NOT NULL DEFAULT ''`);
    await q.query(`ALTER TABLE \`whatsapp_settings\` ADD COLUMN \`messageTemplate\` TEXT NULL`);
    await q.query(`DROP TABLE IF EXISTS \`whatsapp_templates\``);
  }
}
```

- [ ] **Step 2: Actualizar entidad y servicio**

`src/entities/whatsapp-settings.entity.ts`: eliminar los `@Column` de `driverPhone` y `messageTemplate` (dejar `id`, `enabled`, `updatedAt`).

`src/whatsapp-settings/whatsapp-settings.service.ts`:
- Quitar el import de `DEFAULT_DRIVER_PHONE, DEFAULT_MESSAGE_TEMPLATE`.
- En `get()`, crear el singleton solo con `enabled: true`.
- En `update()`, eliminar la normalización de `driverPhone`.

```ts
async get(): Promise<WhatsappSettings> {
  let row = await this.repo.findOne({ where: {}, order: { id: 'ASC' } });
  if (!row) row = await this.repo.save(this.repo.create({ enabled: true }));
  return row;
}

async update(dto: Partial<WhatsappSettings>): Promise<WhatsappSettings> {
  const row = await this.get();
  const { id, ...rest } = dto as any;
  Object.assign(row, rest);
  row.updatedAt = new Date();
  return this.repo.save(row);
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: sin errores. (Si algún consumidor aún lee `settings.driverPhone`/`messageTemplate` en backend, aparecerá aquí — arreglar. Ver Task C2 para el gateway.)

- [ ] **Step 4: Correr la migración en local (si hay BD dev)**

Run: `npm run migration:run`
Expected: migración `...034` aplicada; `DESCRIBE whatsapp_settings` sin `driverPhone`/`messageTemplate`; `SELECT key FROM whatsapp_templates` muestra las 5 claves.
(Si no hay BD local disponible, omitir y confiar en `tsc` + specs; anotarlo en el commit.)

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/1786000000034-WhatsappTemplatesAndSettingsCleanup.ts src/entities/whatsapp-settings.entity.ts src/whatsapp-settings/whatsapp-settings.service.ts
git commit -m "feat(whatsapp): migración crea whatsapp_templates y limpia whatsapp_settings"
```

---

### Task C2: `/whatsapp/send` exige `to`

**Files:**
- Modify: `src/whatsapp-gateway/whatsapp-gateway.controller.ts`
- Test: `src/whatsapp-gateway/whatsapp-gateway.controller.spec.ts`

**Interfaces:**
- Consumes: `WhatsappGatewayService.sendText(to, message)`.
- Produces: `send` lanza `BadRequestException` si falta `message` o `to`; ya no depende de `WhatsappSettingsService`.

- [ ] **Step 1: Escribir el test que falla**

`src/whatsapp-gateway/whatsapp-gateway.controller.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { WhatsappGatewayController } from './whatsapp-gateway.controller';

describe('WhatsappGatewayController.send', () => {
  const gateway: any = { sendText: jest.fn().mockResolvedValue({ ok: true }) };
  const ctrl = new WhatsappGatewayController(gateway);

  it('sin to lanza 400', async () => {
    await expect(ctrl.send({ message: 'hola' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('con to delega en sendText con solo dígitos', async () => {
    await ctrl.send({ message: 'hola', to: '+52 (644) 423-0374' } as any);
    expect(gateway.sendText).toHaveBeenCalledWith('526444230374', 'hola');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/whatsapp-gateway/whatsapp-gateway.controller.spec.ts`
Expected: FAIL (constructor aún pide `WhatsappSettingsService`; sin `to` no lanza).

- [ ] **Step 3: Implementar**

Editar `whatsapp-gateway.controller.ts`: quitar la dependencia `WhatsappSettingsService` del constructor y el fallback. `send`:

```ts
@Post('send')
async send(@Body() dto: { message?: string; to?: string }) {
  const message = (dto?.message || '').trim();
  if (!message) throw new BadRequestException('El mensaje no puede estar vacío.');
  const to = (dto?.to || '').replace(/\D/g, '');
  if (!to) throw new BadRequestException('Falta el número destino.');
  return this.gateway.sendText(to, message);
}
```

Actualizar el constructor a `constructor(private readonly gateway: WhatsappGatewayService) {}` y quitar el import de `WhatsappSettingsService`. Verificar que `whatsapp-gateway.module.ts` ya no necesite importar el módulo de settings solo por esto (dejar el resto igual).

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/whatsapp-gateway/whatsapp-gateway.controller.spec.ts && npx tsc --noEmit`
Expected: PASS y sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/whatsapp-gateway/whatsapp-gateway.controller.ts src/whatsapp-gateway/whatsapp-gateway.controller.spec.ts src/whatsapp-gateway/whatsapp-gateway.module.ts
git commit -m "feat(whatsapp): /whatsapp/send exige número destino (sin fallback)"
```

---

### Task C3: Suite completa backend verde

**Files:** (sin cambios de código salvo fixes que surjan)

- [ ] **Step 1: Correr toda la suite**

Run: `npm test`
Expected: PASS. Prestar atención a specs que dependían de `driverPhone`/`messageTemplate` (p.ej. si existía `whatsapp-settings.service.spec.ts`). Arreglar cualquier referencia rota.

- [ ] **Step 2: Commit (si hubo fixes)**

```bash
git add -A
git commit -m "test(whatsapp): ajustar specs tras limpieza de whatsapp_settings"
```

---

## Fase D — Frontend (app-pmy)

> Trabajar en `D:\PMY\app-pmy`. No hay suite de tests unitarios establecida para UI; la verificación es por `tsc`/build + Browser pane (dev server). Correr `graphify query` dentro de app-pmy antes de leer archivos si existe su grafo.

### Task D1: Servicio `whatsapp-templates` + tipos

**Files:**
- Create: `D:\PMY\app-pmy\lib\services\whatsapp-templates.ts`
- Modify: `D:\PMY\app-pmy\lib\services\whatsapp-settings.ts` (quitar `driverPhone`/`messageTemplate` del tipo; `buildDriverMessage` recibe el `body` explícito)

**Interfaces:**
- Produces:
  - `type WhatsappTemplate = { id: string; key: string; name: string; body: string; active: boolean; updatedAt?: string }`
  - `listWhatsappTemplates(): Promise<WhatsappTemplate[]>`, `createWhatsappTemplate(dto)`, `updateWhatsappTemplate(id, dto)`, `deleteWhatsappTemplate(id)` (contra `whatsapp-templates`).
  - `buildMessage(body: string, ctx: Record<string,string>): string` (reemplaza `{placeholder}`), reemplazo del actual `buildDriverMessage`.

- [ ] **Step 1: Crear el servicio**

Seguir el patrón del cliente HTTP existente en `lib/services/whatsapp-settings.ts` (misma instancia/axios/fetch y manejo de auth). `lib/services/whatsapp-templates.ts`:

```ts
import { api } from './whatsapp-settings'; // o el cliente HTTP compartido que use el repo

export type WhatsappTemplate = {
  id: string; key: string; name: string; body: string; active: boolean; updatedAt?: string;
};

export async function listWhatsappTemplates(): Promise<WhatsappTemplate[]> {
  const { data } = await api.get('whatsapp-templates');
  return data;
}
export async function createWhatsappTemplate(dto: Partial<WhatsappTemplate>) {
  const { data } = await api.post('whatsapp-templates', dto);
  return data as WhatsappTemplate;
}
export async function updateWhatsappTemplate(id: string, dto: Partial<WhatsappTemplate>) {
  const { data } = await api.put(`whatsapp-templates/${id}`, dto);
  return data as WhatsappTemplate;
}
export async function deleteWhatsappTemplate(id: string) {
  await api.delete(`whatsapp-templates/${id}`);
}

/** Reemplaza {placeholder} por el valor del contexto (vacío si falta). */
export function buildMessage(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
}
```

> Ajustar el import `api` al cliente real (revisar cómo `whatsapp-settings.ts` hace sus llamadas y reusar exactamente eso). Si `whatsapp-settings.ts` no exporta el cliente, importar el cliente compartido del repo.

- [ ] **Step 2: Depurar el tipo de settings**

En `lib/services/whatsapp-settings.ts`: quitar `driverPhone` y `messageTemplate` del tipo `WhatsappSettings`. Reemplazar `buildDriverMessage(settings.messageTemplate, ctx)` por el nuevo `buildMessage(body, ctx)` (mantener un re-export de compatibilidad si otros archivos lo importan, o actualizar los imports en el mismo commit).

- [ ] **Step 3: Verificar tipos**

Run (en `D:\PMY\app-pmy`): `npx tsc --noEmit`
Expected: los errores que aparezcan serán en `whatsapp-config-panel.tsx` y `send-driver-message.tsx` (se arreglan en D2/D3). Confirmar que el nuevo servicio compila.

- [ ] **Step 4: Commit**

```bash
cd /d/PMY/app-pmy && git add lib/services/whatsapp-templates.ts lib/services/whatsapp-settings.ts && git commit -m "feat(whatsapp): cliente de plantillas + buildMessage; limpiar tipo settings"
```

---

### Task D2: Gestor de plantillas en Configuración

**Files:**
- Modify: `D:\PMY\app-pmy\components\configuracion\whatsapp-config-panel.tsx`

**Interfaces:**
- Consumes: `listWhatsappTemplates`, `createWhatsappTemplate`, `updateWhatsappTemplate`, `deleteWhatsappTemplate`.

- [ ] **Step 1: Reemplazar campos por gestor de plantillas**

En `whatsapp-config-panel.tsx`:
- Eliminar los Inputs de `driverPhone` y el Textarea de `messageTemplate` (y su estado/handlers).
- Conservar el Switch `enabled` y el `WhatsappConnectionCard`. En `WhatsappConnectionCard`, el campo "Enviar mensaje de prueba" ahora incluye un input de número (ya no usa `driverPhone`).
- Agregar una sección "Plantillas de WhatsApp": lista de `listWhatsappTemplates()` con, por fila, `name`, toggle `active`, y botones Editar/Eliminar; un editor (Textarea `body` + Input `name`) que guarda con `updateWhatsappTemplate`/`createWhatsappTemplate`; chips con los placeholders soportados (`{sucursal} {chofer} {fecha} {seguimiento} {link} {ruta} {unidad} {cliente} {direccion} {cp} {guias} {vence}`).

- [ ] **Step 2: Verificar en el navegador**

- `mcp__Claude_Browser__preview_start` con la config del dev server de app-pmy (crear `.claude/launch.json` si falta: `next dev`, puerto real).
- Navegar a `/configuracion`, abrir el panel de WhatsApp.
- Confirmar: ya no hay campo "Número del chofer"; se listan las plantillas; editar `desembarque`, guardar, recargar y ver el cambio persistido (`read_console_messages` sin errores; `read_network_requests` muestra `PUT whatsapp-templates/...` 200).

- [ ] **Step 3: Commit**

```bash
cd /d/PMY/app-pmy && git add components/configuracion/whatsapp-config-panel.tsx && git commit -m "feat(config): gestor de plantillas de WhatsApp (elimina número/plantilla fijos)"
```

---

### Task D3: Componente reutilizable `EnviarNotificacion`

**Files:**
- Create: `D:\PMY\app-pmy\components\notificaciones\enviar-notificacion.tsx`
- Modify: `D:\PMY\app-pmy\components\monitoreo\send-driver-message.tsx` (reusar el nuevo componente o migrar su lógica)

**Interfaces:**
- Produces: `EnviarNotificacionButton` con props:
```ts
type NumberOption = { label: string; value: string }; // value = teléfono
type Props = {
  templateKeys: string[];              // plantillas ofrecidas para este módulo
  context: Record<string, string>;     // valores para {placeholders}, incluido {link}
  numberOptions: NumberOption[];        // p.ej. [{label:'Chofer', value:driverPhone}]
  triggerLabel?: string;
};
```

- [ ] **Step 1: Implementar el componente**

`components/notificaciones/enviar-notificacion.tsx` (usar los componentes UI del repo: Dialog, Select, Input, Textarea, Button):

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { listWhatsappTemplates, buildMessage, type WhatsappTemplate } from '@/lib/services/whatsapp-templates';
import { sendWhatsappMessage } from '@/lib/services/whatsapp-settings'; // POST whatsapp/send { message, to }

type NumberOption = { label: string; value: string };
type Props = {
  templateKeys: string[];
  context: Record<string, string>;
  numberOptions: NumberOption[];
  triggerLabel?: string;
};

export function EnviarNotificacionButton({ templateKeys, context, numberOptions, triggerLabel = 'Enviar notificación' }: Props) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [templateKey, setTemplateKey] = useState(templateKeys[0] ?? '');
  const [numberMode, setNumberMode] = useState<'custom' | string>(numberOptions[0]?.value ?? 'custom');
  const [customNumber, setCustomNumber] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    listWhatsappTemplates().then((all) => setTemplates(all.filter((t) => t.active && templateKeys.includes(t.key))));
  }, [open, templateKeys]);

  const selected = useMemo(() => templates.find((t) => t.key === templateKey), [templates, templateKey]);
  useEffect(() => { if (selected) setMessage(buildMessage(selected.body, context)); }, [selected, context]);

  const to = numberMode === 'custom' ? customNumber : numberMode;

  async function onSend() {
    await sendWhatsappMessage(message, to.replace(/\D/g, ''));
    setOpen(false);
  }

  // ...render Dialog: Select de plantilla (templates), Select de número
  // (numberOptions + opción "Custom" -> Input customNumber), Textarea message,
  // Button "Enviar por WhatsApp" (disabled si !message || !to).
}
```

Completar el JSX del Dialog con los componentes UI existentes del repo (mirar `send-driver-message.tsx` para el estilo de Dialog/Textarea/Button ya usado).

- [ ] **Step 2: Migrar `send-driver-message.tsx`**

Reescribir `send-driver-message.tsx` para renderizar `EnviarNotificacionButton` con:
- `templateKeys={['prioridad_entrega']}`
- `context` = los valores actuales (`{cliente,direccion,cp,guias,vence,ruta,chofer}`)
- `numberOptions` = `[{ label: 'Chofer', value: stop.driverPhone }]` (el teléfono del chofer de la parada, que hoy venía de settings; ahora del contexto del monitor).
- `triggerLabel="Avisar al chofer"`.

Ajustar `route-monitor-board.tsx` si `canNotify` dependía de `settings.driverPhone`: ahora depende de que exista teléfono de chofer en el contexto de la parada.

- [ ] **Step 3: Verificar en el navegador**

- Recargar el dev server. Ir a `/monitoreo-rutas` (o el módulo donde haya una parada en riesgo).
- Abrir "Avisar al chofer": confirmar selector de número (Chofer/Custom) y que el mensaje se arma desde la plantilla `prioridad_entrega`.
- Enviar de prueba: `read_network_requests` muestra `POST whatsapp/send` con `{ message, to }`, 200.

- [ ] **Step 4: Commit**

```bash
cd /d/PMY/app-pmy && git add components/notificaciones/enviar-notificacion.tsx components/monitoreo/send-driver-message.tsx components/monitoreo/route-monitor-board.tsx && git commit -m "feat(notificaciones): componente reutilizable Enviar notificación con selector de número"
```

---

### Task D4: Montar `EnviarNotificacion` en los módulos

**Files:**
- Modify: `D:\PMY\app-pmy\app\operaciones\salidas-a-ruta\page.tsx` (y/o su tabla de filas)
- Modify: `D:\PMY\app-pmy\app\operaciones\desembarques\page.tsx`
- Modify: `D:\PMY\app-pmy\app\operaciones\inventarios\page.tsx`
- Modify: `D:\PMY\app-pmy\app\reportes\page.tsx`

**Interfaces:**
- Consumes: `EnviarNotificacionButton`.

- [ ] **Step 1: Montar en cada módulo**

Para cada registro/fila, renderizar `EnviarNotificacionButton` con el `templateKey` del módulo, `numberOptions` construidos desde lo disponible (chofer → `driver.phoneNumber`; encargado → `subsidiary.managerPhone`; siempre Custom), y `context` con `{sucursal, chofer, fecha, seguimiento, ruta, unidad, link}` donde `link` = base del front + ruta del módulo + `?seguimiento=<tracking>`.

| Página | templateKey | numberOptions | link |
|---|---|---|---|
| salidas-a-ruta | `salida_ruta` | Chofer, Encargado, Custom | `/operaciones/salidas-a-ruta?seguimiento=<t>` |
| desembarques | `desembarque` | Encargado, Custom | `/operaciones/desembarques?seguimiento=<t>` |
| inventarios | `inventario` | Encargado, Custom | `/operaciones/inventarios?seguimiento=<t>` |
| reportes | `reporte` | Encargado, Custom | `/reportes` |

Para el `link` usar la base pública del front del repo (revisar cómo se construyen URLs absolutas en app-pmy; si no hay helper, usar `window.location.origin`).

- [ ] **Step 2: Verificar en el navegador**

Navegar a cada ruta; abrir "Enviar notificación"; confirmar que el número ofrece las opciones esperadas y que el mensaje incluye el `{link}` correcto con `?seguimiento=`.

- [ ] **Step 3: Commit**

```bash
cd /d/PMY/app-pmy && git add app/operaciones/salidas-a-ruta/page.tsx app/operaciones/desembarques/page.tsx app/operaciones/inventarios/page.tsx app/reportes/page.tsx && git commit -m "feat(operaciones): botón Enviar notificación por módulo (salida/desembarque/inventario/reporte)"
```

---

### Task D5: Foco por `?seguimiento=` en las listas

**Files:**
- Modify: `D:\PMY\app-pmy\app\operaciones\salidas-a-ruta\page.tsx`
- Modify: `D:\PMY\app-pmy\app\operaciones\desembarques\page.tsx`
- Modify: `D:\PMY\app-pmy\app\operaciones\inventarios\page.tsx`

**Interfaces:**
- Consumes: `useSearchParams` de `next/navigation`.

- [ ] **Step 1: Implementar el foco**

En cada página de lista, tras cargar los datos, leer `useSearchParams().get('seguimiento')`; si hay valor, buscar el registro cuyo `trackingNumber` coincida y resaltarlo (scroll + estilo temporal) o abrir su diálogo de detalle si existe. Si no coincide, no hacer nada (comportamiento normal de la lista).

```tsx
'use client';
import { useSearchParams } from 'next/navigation';
// ...
const seguimiento = useSearchParams().get('seguimiento');
useEffect(() => {
  if (!seguimiento || !rows.length) return;
  const target = rows.find((r) => r.trackingNumber === seguimiento);
  if (target) {
    // scrollIntoView del elemento + marcar highlightedId=target.id por unos segundos
  }
}, [seguimiento, rows]);
```

- [ ] **Step 2: Verificar en el navegador**

Navegar a `/operaciones/desembarques?seguimiento=<un tracking real>`; confirmar que el registro correspondiente queda resaltado/visible. Probar con un tracking inexistente: la lista carga normal sin error (`read_console_messages` limpio).

- [ ] **Step 3: Commit**

```bash
cd /d/PMY/app-pmy && git add app/operaciones/salidas-a-ruta/page.tsx app/operaciones/desembarques/page.tsx app/operaciones/inventarios/page.tsx && git commit -m "feat(operaciones): enfocar registro por ?seguimiento= (deep-link de correos)"
```

---

## Verificación final (end-to-end)

- [ ] **Backend:** `npm test` verde; `npm run build` sin errores; `npm run seed` puebla `whatsapp_templates` (5 claves).
- [ ] **Correo real (dev):** disparar un desembarque/salida en ambiente dev → el correo llega con asunto descriptivo, seguimiento y botón "Ver en el sistema" cuyo link abre la lista y enfoca el registro.
- [ ] **WhatsApp:** desde un módulo, "Enviar notificación" → elegir plantilla + número (chofer/encargado/custom) → llega el mensaje con `{link}` correcto.
- [ ] **Config:** las plantillas se editan y persisten; ya no existe el campo "Número del chofer".

---

## Notas de decomposición

- Fases A/B/C son backend y pueden ejecutarse/mergearse antes que la D (frontend depende de los endpoints `whatsapp-templates` y del `/whatsapp/send` sin fallback).
- Si se prefiere, D puede ser un plan/PR separado en el repo `app-pmy` una vez que el backend esté desplegado en el ambiente que consume el frontend.
