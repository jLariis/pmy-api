# Motor de Plantillas — Fase 1 Backend (Núcleo + Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo del motor de plantillas (`TemplateService.render(code, data)`) y el `EmailRenderer`, migrar todos los correos actuales a plantillas configurables desde BD conservando cada variable (paridad), sin romper ninguna operación.

**Architecture:** Un módulo `src/documents/` con un núcleo format-agnóstico (resuelve variables Handlebars + branding, carga la versión publicada, loguea, hace fallback) y un `RendererRegistry` de renderers plug-in. En Fase 1 solo se registra `EmailRenderer` (Handlebars → MJML → HTML responsivo). `MailService` queda como transporte puro. Un seed idempotente recrea los correos actuales.

**Tech Stack:** NestJS, TypeORM (MySQL), Handlebars, MJML, `@nestjs-modules/mailer` (existente), Jest.

## Global Constraints

- Entidades auto-cargadas por glob `src/entities/*.entity.{js,ts}`; exportar desde `src/entities/index.ts`.
- PKs `@PrimaryGeneratedColumn('uuid')` → en MySQL materializan como `VARCHAR(36)` (NO `CHAR(36)`) en las migraciones. Columnas FK reales deben ser `VARCHAR(36) COLLATE utf8mb4_unicode_ci`; columnas *Id que solo referencian ids sin constraint van `CHAR(36)`.
- Timestamps: `@Column({ type: 'datetime' })`. Tablas `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.
- Prefijo global de rutas: `api`. Guard de admin: `SuperAdminGuard` de `src/audit/super-admin.guard.ts`, aplicado con `@UseGuards(SuperAdminGuard)`.
- **Regla best-effort:** ningún efecto lateral (email, render log) rompe la request. `TemplateService.render()` **NUNCA lanza** al llamador (fallback en error).
- Migraciones en `src/database/migrations/` con prefijo timestamp incremental (siguiente: `1786000000033`). Correr: `npm run migration:run`. Dev puede usar `DB_SYNC=true`.
- Tests: unit puros — instanciar el servicio con repos mock (`new Service(repoMock, ...)`), sin `Test.createTestingModule`. Correr con `npm test`.
- Zona horaria de negocio: `America/Hermosillo`. Reutilizar `formatToHermosillo` de `src/common/utils` donde aplique.
- Idioma de contenido: solo `es` en Fase 1. Columnas multi-tenant (`tenantId`) presentes pero sin lógica.

---

## Task 1: Dependencias + Entidades + barrel

**Files:**
- Modify: `package.json` (deps)
- Create: `src/entities/brand.entity.ts`
- Create: `src/entities/document-template.entity.ts`
- Create: `src/entities/document-template-version.entity.ts`
- Create: `src/entities/template-variable-def.entity.ts`
- Create: `src/entities/template-render-log.entity.ts`
- Modify: `src/entities/index.ts`

**Interfaces:**
- Produces: entidades `Brand`, `DocumentTemplate`, `DocumentTemplateVersion`, `TemplateVariableDef`, `TemplateRenderLog`; el tipo `DocumentFormat` (exportado desde `document-template.entity.ts`) usado por todas las tareas siguientes.

- [ ] **Step 1: Instalar dependencias**

Run: `npm install handlebars mjml`
Expected: se agregan a `dependencies` (mjml trae sus propios tipos).

- [ ] **Step 2: Crear `brand.entity.ts`**

```ts
// src/entities/brand.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface BrandColors { primary?: string; secondary?: string; button?: string; text?: string; background?: string; }
export interface BrandTypography { fontFamily?: string; baseSize?: string; }
export interface BrandFiscal { razonSocial?: string; rfc?: string; direccion?: string; }
export interface BrandContact { phone?: string; email?: string; website?: string; }
export interface BrandSocial { facebook?: string; instagram?: string; whatsapp?: string; }

/** Identidad visual GLOBAL de la empresa (una fila, key='default'). */
@Entity('brand')
export class Brand {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40, default: 'default' }) key: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) logoLight: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) logoDark: string | null;
  @Column({ type: 'json', nullable: true }) colors: BrandColors | null;
  @Column({ type: 'json', nullable: true }) typography: BrandTypography | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) borderRadius: string | null;
  @Column({ type: 'json', nullable: true }) spacing: Record<string, string> | null;
  @Column({ type: 'json', nullable: true }) fiscal: BrandFiscal | null;
  @Column({ type: 'json', nullable: true }) contact: BrandContact | null;
  @Column({ type: 'json', nullable: true }) social: BrandSocial | null;
  @Column({ type: 'char', length: 36, nullable: true }) tenantId: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) updatedAt: Date;
}
```

- [ ] **Step 3: Crear `document-template.entity.ts`**

```ts
// src/entities/document-template.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DocumentFormat =
  | 'email' | 'pdf' | 'excel' | 'report' | 'letter' | 'receipt' | 'label' | 'statement';

/** Plantilla de documento. Un `code` por documento (route_dispatch, unloading, …). */
@Entity('document_template')
@Index('uq_document_template_code_lang', ['code', 'language'], { unique: true })
export class DocumentTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) code: string;
  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'varchar', length: 20 }) type: DocumentFormat;
  @Column({ type: 'varchar', length: 300, nullable: true }) description: string | null;
  @Column({ type: 'varchar', length: 8, default: 'es' }) language: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ type: 'varchar', length: 60, nullable: true }) category: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) currentVersionId: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) tenantId: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) updatedAt: Date;
}
```

- [ ] **Step 4: Crear `document-template-version.entity.ts`**

```ts
// src/entities/document-template-version.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type VersionStatus = 'draft' | 'published' | 'archived';

/** Versión inmutable de una plantilla. Restaurar = clonar en una versión nueva. */
@Entity('document_template_version')
@Index('uq_dtv_template_version', ['templateId', 'version'], { unique: true })
export class DocumentTemplateVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) templateId: string; // FK real → document_template.id
  @Column({ type: 'int' }) version: number;
  @Column({ type: 'varchar', length: 20, default: 'draft' }) status: VersionStatus;
  @Column({ type: 'varchar', length: 300, nullable: true }) subject: string | null;
  @Column({ type: 'json', nullable: true }) designJson: any;
  @Column({ type: 'longtext', nullable: true }) compiledBody: string | null;
  @Column({ type: 'varchar', length: 20, default: 'handlebars' }) engine: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) changelog: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) createdById: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) createdByName: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', nullable: true }) publishedAt: Date | null;
}
```

- [ ] **Step 5: Crear `template-variable-def.entity.ts`**

```ts
// src/entities/template-variable-def.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type VariableDataType = 'string' | 'number' | 'date' | 'currency' | 'boolean';

/** Variable declarada para una plantilla: paleta del editor + validación + sample. */
@Entity('template_variable_def')
@Index('idx_tvd_template', ['templateId'])
export class TemplateVariableDef {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) templateId: string; // FK real → document_template.id
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 160 }) label: string;
  @Column({ type: 'varchar', length: 20, default: 'string' }) dataType: VariableDataType;
  @Column({ type: 'varchar', length: 300, nullable: true }) example: string | null;
  @Column({ type: 'boolean', default: false }) required: boolean;
}
```

- [ ] **Step 6: Crear `template-render-log.entity.ts`**

```ts
// src/entities/template-render-log.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RenderStatus = 'ok' | 'fallback' | 'error';

/** Observabilidad best-effort de cada render. */
@Entity('template_render_log')
@Index('idx_trl_code_created', ['code', 'createdAt'])
export class TemplateRenderLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) code: string;
  @Column({ type: 'int', default: 0 }) version: number;
  @Column({ type: 'varchar', length: 20 }) format: string;
  @Column({ type: 'varchar', length: 20 }) status: RenderStatus;
  @Column({ type: 'varchar', length: 64, nullable: true }) entityId: string | null;
  @Column({ type: 'int', nullable: true }) ms: number | null;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
```

- [ ] **Step 7: Exportar desde el barrel**

Añadir al final de `src/entities/index.ts`:

```ts
export * from './brand.entity';
export * from './document-template.entity';
export * from './document-template-version.entity';
export * from './template-variable-def.entity';
export * from './template-render-log.entity';
```

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: compila sin errores (entidades se auto-registran por glob).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/entities/
git commit -m "feat(documents): entidades del motor de plantillas + deps (handlebars, mjml)"
```

---

## Task 2: Migración de esquema

**Files:**
- Create: `src/database/migrations/1786000000033-CreateDocumentTemplates.ts`

**Interfaces:**
- Consumes: columnas de las entidades de Task 1.
- Produces: tablas `brand`, `document_template`, `document_template_version`, `template_variable_def`, `template_render_log`.

- [ ] **Step 1: Escribir la migración (SQL a mano, estilo del repo)**

```ts
// src/database/migrations/1786000000033-CreateDocumentTemplates.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del motor de plantillas. `id` uuid materializa como VARCHAR(36).
 * templateId es FK real → document_template.id: VARCHAR(36) COLLATE utf8mb4_unicode_ci.
 */
export class CreateDocumentTemplates1786000000033 implements MigrationInterface {
  name = 'CreateDocumentTemplates1786000000033';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`brand\` (
        \`id\`           VARCHAR(36)  NOT NULL,
        \`key\`          VARCHAR(40)  NOT NULL DEFAULT 'default',
        \`logoLight\`    VARCHAR(500) NULL,
        \`logoDark\`     VARCHAR(500) NULL,
        \`colors\`       JSON         NULL,
        \`typography\`   JSON         NULL,
        \`borderRadius\` VARCHAR(20)  NULL,
        \`spacing\`      JSON         NULL,
        \`fiscal\`       JSON         NULL,
        \`contact\`      JSON         NULL,
        \`social\`       JSON         NULL,
        \`tenantId\`     CHAR(36)     NULL,
        \`updatedAt\`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_brand_key\` (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`document_template\` (
        \`id\`               VARCHAR(36)  NOT NULL,
        \`code\`             VARCHAR(80)  NOT NULL,
        \`name\`             VARCHAR(160) NOT NULL,
        \`type\`             VARCHAR(20)  NOT NULL,
        \`description\`      VARCHAR(300) NULL,
        \`language\`         VARCHAR(8)   NOT NULL DEFAULT 'es',
        \`active\`           TINYINT(1)   NOT NULL DEFAULT 1,
        \`category\`         VARCHAR(60)  NULL,
        \`currentVersionId\` CHAR(36)     NULL,
        \`tenantId\`         CHAR(36)     NULL,
        \`createdAt\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_document_template_code_lang\` (\`code\`, \`language\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`document_template_version\` (
        \`id\`            VARCHAR(36)  NOT NULL,
        \`templateId\`    VARCHAR(36)  NOT NULL COLLATE utf8mb4_unicode_ci,
        \`version\`       INT          NOT NULL,
        \`status\`        VARCHAR(20)  NOT NULL DEFAULT 'draft',
        \`subject\`       VARCHAR(300) NULL,
        \`designJson\`    JSON         NULL,
        \`compiledBody\`  LONGTEXT     NULL,
        \`engine\`        VARCHAR(20)  NOT NULL DEFAULT 'handlebars',
        \`changelog\`     VARCHAR(500) NULL,
        \`createdById\`   CHAR(36)     NULL,
        \`createdByName\` VARCHAR(160) NULL,
        \`createdAt\`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`publishedAt\`   DATETIME     NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_dtv_template_version\` (\`templateId\`, \`version\`),
        CONSTRAINT \`fk_dtv_template\` FOREIGN KEY (\`templateId\`)
          REFERENCES \`document_template\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`template_variable_def\` (
        \`id\`         VARCHAR(36)  NOT NULL,
        \`templateId\` VARCHAR(36)  NOT NULL COLLATE utf8mb4_unicode_ci,
        \`name\`       VARCHAR(80)  NOT NULL,
        \`label\`      VARCHAR(160) NOT NULL,
        \`dataType\`   VARCHAR(20)  NOT NULL DEFAULT 'string',
        \`example\`    VARCHAR(300) NULL,
        \`required\`   TINYINT(1)   NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`idx_tvd_template\` (\`templateId\`),
        CONSTRAINT \`fk_tvd_template\` FOREIGN KEY (\`templateId\`)
          REFERENCES \`document_template\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS \`template_render_log\` (
        \`id\`        VARCHAR(36) NOT NULL,
        \`code\`      VARCHAR(80) NOT NULL,
        \`version\`   INT         NOT NULL DEFAULT 0,
        \`format\`    VARCHAR(20) NOT NULL,
        \`status\`    VARCHAR(20) NOT NULL,
        \`entityId\`  VARCHAR(64) NULL,
        \`ms\`        INT         NULL,
        \`error\`     TEXT        NULL,
        \`createdAt\` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_trl_code_created\` (\`code\`, \`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `template_render_log`');
    await q.query('DROP TABLE IF EXISTS `template_variable_def`');
    await q.query('DROP TABLE IF EXISTS `document_template_version`');
    await q.query('DROP TABLE IF EXISTS `document_template`');
    await q.query('DROP TABLE IF EXISTS `brand`');
  }
}
```

- [ ] **Step 2: Correr la migración**

Run: `npm run migration:run`
Expected: crea las 5 tablas sin error.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations/1786000000033-CreateDocumentTemplates.ts
git commit -m "feat(documents): migración de tablas del motor de plantillas"
```

---

## Task 3: Tipos compartidos + interfaz DocumentRenderer

**Files:**
- Create: `src/documents/documents.types.ts`
- Create: `src/documents/renderers/renderer.interface.ts`

**Interfaces:**
- Consumes: `DocumentFormat` (Task 1), `DocumentTemplateVersion` (Task 1).
- Produces: `BrandTokens`, `DEFAULT_BRAND_TOKENS`, `RenderContext`, `RenderResult`, `DocumentRenderer`.

- [ ] **Step 1: Crear los tipos compartidos**

```ts
// src/documents/documents.types.ts
import { BrandColors, BrandContact, BrandFiscal, BrandSocial, BrandTypography } from 'src/entities/brand.entity';

export interface BrandTokens {
  logoLight: string | null;
  logoDark: string | null;
  colors: Required<BrandColors>;
  typography: Required<BrandTypography>;
  borderRadius: string;
  fiscal: BrandFiscal;
  contact: BrandContact;
  social: BrandSocial;
}

/** Valores por defecto seguros para que un render NUNCA falle por branding vacío. */
export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  logoLight: null,
  logoDark: null,
  colors: { primary: '#3498db', secondary: '#2c3e50', button: '#2980b9', text: '#2c3e50', background: '#ffffff' },
  typography: { fontFamily: 'Arial, sans-serif', baseSize: '14px' },
  borderRadius: '8px',
  fiscal: {},
  contact: { website: 'https://app-pmy.vercel.app/' },
  social: {},
};

export interface RenderContext {
  data: Record<string, any>;
  brand: BrandTokens;
  system: { now: Date; appUrl: string; env: string };
}

import { DocumentFormat } from 'src/entities/document-template.entity';

export interface RenderResult {
  format: DocumentFormat;
  mime: string;
  filename?: string;
  html?: string;
  subject?: string;
  buffer?: Buffer;
}
```

- [ ] **Step 2: Crear la interfaz del renderer**

```ts
// src/documents/renderers/renderer.interface.ts
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { RenderContext, RenderResult } from '../documents.types';

/** Contrato que implementa cada formato de salida (email, pdf, excel, …). */
export interface DocumentRenderer {
  readonly format: DocumentFormat;
  render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult>;
}

/** Token DI para coleccionar todos los renderers registrados. */
export const DOCUMENT_RENDERERS = Symbol('DOCUMENT_RENDERERS');
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add src/documents/documents.types.ts src/documents/renderers/renderer.interface.ts
git commit -m "feat(documents): tipos compartidos + interfaz DocumentRenderer"
```

---

## Task 4: TemplateEngine (Handlebars)

**Files:**
- Create: `src/documents/template-engine.ts`
- Create: `src/documents/template-engine.spec.ts`

**Interfaces:**
- Produces: `TemplateEngine.render(source: string, ctx: RenderContext): string`. Interpola `{{var}}` desde `ctx.data`, con acceso a `{{brand.*}}` y `{{system.*}}`. Helper `formatDate` (fecha en `America/Hermosillo`, formato `dd/MM/yyyy hh:mm aa`).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/template-engine.spec.ts
import { TemplateEngine } from './template-engine';
import { DEFAULT_BRAND_TOKENS } from './documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date('2026-07-11T20:00:00Z'), appUrl: 'https://x', env: 'test' } };
}

describe('TemplateEngine', () => {
  const engine = new TemplateEngine();

  it('interpola variables de data', () => {
    expect(engine.render('Hola {{cliente}}', ctx({ cliente: 'Ana' }))).toBe('Hola Ana');
  });

  it('expone brand y system', () => {
    const out = engine.render('{{brand.colors.primary}}|{{system.env}}', ctx({}));
    expect(out).toBe('#3498db|test');
  });

  it('variable faltante => cadena vacía, no rompe', () => {
    expect(engine.render('X{{noExiste}}Y', ctx({}))).toBe('XY');
  });

  it('helper formatDate en zona Hermosillo', () => {
    const out = engine.render('{{formatDate fecha}}', ctx({ fecha: '2026-07-11T20:00:00Z' }));
    expect(out).toMatch(/11\/07\/2026/);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- template-engine`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```ts
// src/documents/template-engine.ts
import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { RenderContext } from './documents.types';

const TZ = 'America/Hermosillo';

/** Motor de interpolación logic-less. Escapa valores por defecto (anti-inyección). */
@Injectable()
export class TemplateEngine {
  private readonly hb: typeof Handlebars;

  constructor() {
    this.hb = Handlebars.create();
    this.hb.registerHelper('formatDate', (value: any) => {
      if (!value) return '';
      try {
        return format(toZonedTime(new Date(value), TZ), 'dd/MM/yyyy hh:mm aa');
      } catch {
        return String(value);
      }
    });
  }

  render(source: string, ctx: RenderContext): string {
    const tpl = this.hb.compile(source ?? '', { noEscape: false });
    return tpl({ ...ctx.data, brand: ctx.brand, system: ctx.system });
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- template-engine`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/template-engine.ts src/documents/template-engine.spec.ts
git commit -m "feat(documents): TemplateEngine Handlebars con helper formatDate"
```

---

## Task 5: BrandingService

**Files:**
- Create: `src/documents/branding.service.ts`
- Create: `src/documents/branding.service.spec.ts`

**Interfaces:**
- Consumes: repo `Brand`, `BrandTokens`, `DEFAULT_BRAND_TOKENS`.
- Produces: `BrandingService.getTokens(): Promise<BrandTokens>` (cacheado en memoria); `BrandingService.invalidate(): void`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/branding.service.spec.ts
import { BrandingService } from './branding.service';

function make(row: any) {
  const repo: any = { findOne: jest.fn(() => Promise.resolve(row)) };
  return { svc: new BrandingService(repo), repo };
}

describe('BrandingService', () => {
  it('mezcla la fila con los defaults', async () => {
    const { svc } = make({ colors: { primary: '#111' }, logoLight: 'a.png' });
    const t = await svc.getTokens();
    expect(t.colors.primary).toBe('#111');
    expect(t.colors.button).toBe('#2980b9'); // default
    expect(t.logoLight).toBe('a.png');
  });

  it('sin fila => defaults completos', async () => {
    const { svc } = make(null);
    const t = await svc.getTokens();
    expect(t.colors.primary).toBe('#3498db');
  });

  it('cachea: segunda llamada no re-consulta', async () => {
    const { svc, repo } = make({});
    await svc.getTokens();
    await svc.getTokens();
    expect(repo.findOne).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- branding.service`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/branding.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from 'src/entities/brand.entity';
import { BrandTokens, DEFAULT_BRAND_TOKENS } from './documents.types';

@Injectable()
export class BrandingService {
  private cache: BrandTokens | null = null;

  constructor(@InjectRepository(Brand) private readonly repo: Repository<Brand>) {}

  async getTokens(): Promise<BrandTokens> {
    if (this.cache) return this.cache;
    const row = await this.repo.findOne({ where: { key: 'default' } });
    const d = DEFAULT_BRAND_TOKENS;
    this.cache = {
      logoLight: row?.logoLight ?? d.logoLight,
      logoDark: row?.logoDark ?? d.logoDark,
      colors: { ...d.colors, ...(row?.colors ?? {}) },
      typography: { ...d.typography, ...(row?.typography ?? {}) },
      borderRadius: row?.borderRadius ?? d.borderRadius,
      fiscal: { ...d.fiscal, ...(row?.fiscal ?? {}) },
      contact: { ...d.contact, ...(row?.contact ?? {}) },
      social: { ...d.social, ...(row?.social ?? {}) },
    };
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- branding.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/branding.service.ts src/documents/branding.service.spec.ts
git commit -m "feat(documents): BrandingService con merge de defaults + caché"
```

---

## Task 6: VariableResolver

**Files:**
- Create: `src/documents/variable-resolver.service.ts`
- Create: `src/documents/variable-resolver.service.spec.ts`

**Interfaces:**
- Consumes: repo `TemplateVariableDef`, `BrandingService.getTokens()`, `DocumentTemplate` (Task 1), `RenderContext`.
- Produces: `VariableResolver.build(template: DocumentTemplate, data: Record<string, any>): Promise<RenderContext>`. Valida `required`; si falta un `required`, loguea warn y continúa (best-effort).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/variable-resolver.service.spec.ts
import { VariableResolver } from './variable-resolver.service';
import { DEFAULT_BRAND_TOKENS } from './documents.types';

function make(defs: any[]) {
  const varRepo: any = { find: jest.fn(() => Promise.resolve(defs)) };
  const branding: any = { getTokens: () => Promise.resolve(DEFAULT_BRAND_TOKENS) };
  return { svc: new VariableResolver(varRepo, branding) };
}

describe('VariableResolver', () => {
  it('arma el contexto con data + brand + system', async () => {
    const { svc } = make([]);
    const ctx = await svc.build({ id: 't1' } as any, { tracking: 'ABC' });
    expect(ctx.data.tracking).toBe('ABC');
    expect(ctx.brand.colors.primary).toBe('#3498db');
    expect(ctx.system.now).toBeInstanceOf(Date);
  });

  it('no rompe si falta una variable required (best-effort)', async () => {
    const { svc } = make([{ name: 'tracking', required: true }]);
    const ctx = await svc.build({ id: 't1' } as any, {});
    expect(ctx.data.tracking).toBeUndefined(); // no lanza
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- variable-resolver`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/variable-resolver.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { BrandingService } from './branding.service';
import { RenderContext } from './documents.types';

@Injectable()
export class VariableResolver {
  private readonly logger = new Logger(VariableResolver.name);

  constructor(
    @InjectRepository(TemplateVariableDef) private readonly varRepo: Repository<TemplateVariableDef>,
    private readonly branding: BrandingService,
  ) {}

  async build(template: DocumentTemplate, data: Record<string, any>): Promise<RenderContext> {
    const defs = await this.varRepo.find({ where: { templateId: template.id } });
    for (const d of defs) {
      if (d.required && (data?.[d.name] === undefined || data?.[d.name] === null)) {
        this.logger.warn(`Variable required faltante '${d.name}' en plantilla ${template.code}`);
      }
    }
    const brand = await this.branding.getTokens();
    return {
      data: data ?? {},
      brand,
      system: { now: new Date(), appUrl: process.env.FRONTEND_URL ?? 'https://app-pmy.vercel.app/', env: process.env.NODE_ENV ?? 'production' },
    };
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- variable-resolver`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/variable-resolver.service.ts src/documents/variable-resolver.service.spec.ts
git commit -m "feat(documents): VariableResolver (data+brand+system, valida required best-effort)"
```

---

## Task 7: RendererRegistry

**Files:**
- Create: `src/documents/renderer.registry.ts`
- Create: `src/documents/renderer.registry.spec.ts`

**Interfaces:**
- Consumes: `DocumentRenderer`, `DOCUMENT_RENDERERS` (Task 3), `DocumentFormat`.
- Produces: `RendererRegistry.get(format: DocumentFormat): DocumentRenderer` (lanza si no hay renderer para el formato).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/renderer.registry.spec.ts
import { RendererRegistry } from './renderer.registry';

const emailR: any = { format: 'email', render: jest.fn() };

describe('RendererRegistry', () => {
  it('devuelve el renderer por formato', () => {
    const reg = new RendererRegistry([emailR]);
    expect(reg.get('email')).toBe(emailR);
  });

  it('lanza si no hay renderer para el formato', () => {
    const reg = new RendererRegistry([emailR]);
    expect(() => reg.get('pdf')).toThrow(/pdf/);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- renderer.registry`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/renderer.registry.ts
import { Inject, Injectable } from '@nestjs/common';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DOCUMENT_RENDERERS, DocumentRenderer } from './renderers/renderer.interface';

@Injectable()
export class RendererRegistry {
  private readonly byFormat = new Map<DocumentFormat, DocumentRenderer>();

  constructor(@Inject(DOCUMENT_RENDERERS) renderers: DocumentRenderer[]) {
    for (const r of renderers) this.byFormat.set(r.format, r);
  }

  get(format: DocumentFormat): DocumentRenderer {
    const r = this.byFormat.get(format);
    if (!r) throw new Error(`No hay renderer registrado para el formato '${format}'`);
    return r;
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- renderer.registry`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/renderer.registry.ts src/documents/renderer.registry.spec.ts
git commit -m "feat(documents): RendererRegistry (dispatch por formato)"
```

---

## Task 8: FallbackRenderer

**Files:**
- Create: `src/documents/fallback.renderer.ts`
- Create: `src/documents/fallback.renderer.spec.ts`

**Interfaces:**
- Consumes: `RenderResult`, `BrandingService`.
- Produces: `FallbackRenderer.render(code: string, data: Record<string, any>): Promise<RenderResult>` — HTML genérico branded que SIEMPRE se produce (email por defecto).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/fallback.renderer.spec.ts
import { FallbackRenderer } from './fallback.renderer';
import { DEFAULT_BRAND_TOKENS } from './documents.types';

function make() {
  const branding: any = { getTokens: () => Promise.resolve(DEFAULT_BRAND_TOKENS) };
  return new FallbackRenderer(branding);
}

describe('FallbackRenderer', () => {
  it('produce email con html y subject aunque falte todo', async () => {
    const r = await make().render('x_code', {});
    expect(r.format).toBe('email');
    expect(r.mime).toBe('text/html');
    expect(r.html).toContain('<');
    expect(typeof r.subject).toBe('string');
  });

  it('usa data.subject/title si vienen', async () => {
    const r = await make().render('x', { subject: 'Hola', title: 'T', body: 'Cuerpo' });
    expect(r.subject).toBe('Hola');
    expect(r.html).toContain('Cuerpo');
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- fallback.renderer`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/fallback.renderer.ts
import { Injectable } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { RenderResult } from './documents.types';

/** Renderer de último recurso: garantiza que el documento SIEMPRE se emita. */
@Injectable()
export class FallbackRenderer {
  constructor(private readonly branding: BrandingService) {}

  async render(code: string, data: Record<string, any>): Promise<RenderResult> {
    const brand = await this.branding.getTokens();
    const subject = data?.subject ?? data?.title ?? 'Notificación PMY';
    const body = data?.body ?? 'Se generó un documento en el sistema.';
    const html = `
      <div style="font-family:${brand.typography.fontFamily};color:${brand.colors.text};max-width:600px;margin:0 auto">
        <h2 style="border-bottom:3px solid ${brand.colors.primary};padding-bottom:8px">${subject}</h2>
        <p>${body}</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #eee" />
        <p style="font-size:0.85em;color:#7f8c8d">Documento generado automáticamente (plantilla '${code}' no disponible).</p>
      </div>`;
    return { format: 'email', mime: 'text/html', subject, html };
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- fallback.renderer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/fallback.renderer.ts src/documents/fallback.renderer.spec.ts
git commit -m "feat(documents): FallbackRenderer (siempre emite un documento branded)"
```

---

## Task 9: EmailRenderer (Handlebars + MJML)

**Files:**
- Create: `src/documents/renderers/email.renderer.ts`
- Create: `src/documents/renderers/email.renderer.spec.ts`

**Interfaces:**
- Consumes: `DocumentRenderer`, `TemplateEngine.render()`, `RenderContext`, `DocumentTemplateVersion`.
- Produces: `EmailRenderer` (`format='email'`). Interpola `subject` y `compiledBody` con Handlebars; si el cuerpo es MJML (contiene `<mjml`), lo compila a HTML responsivo con `mjml`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/renderers/email.renderer.spec.ts
import { EmailRenderer } from './email.renderer';
import { TemplateEngine } from '../template-engine';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://x', env: 'test' } };
}

describe('EmailRenderer', () => {
  const r = new EmailRenderer(new TemplateEngine());

  it('renderiza HTML plano con variables', async () => {
    const v: any = { subject: 'Envío {{tracking}}', compiledBody: '<p>Hola {{cliente}}</p>' };
    const out = await r.render(v, ctx({ tracking: 'T1', cliente: 'Ana' }));
    expect(out.format).toBe('email');
    expect(out.subject).toBe('Envío T1');
    expect(out.html).toContain('Hola Ana');
  });

  it('compila MJML a HTML responsivo', async () => {
    const v: any = { subject: 'X', compiledBody: '<mjml><mj-body><mj-section><mj-column><mj-text>Hola {{cliente}}</mj-text></mj-column></mj-section></mj-body></mjml>' };
    const out = await r.render(v, ctx({ cliente: 'Ana' }));
    expect(out.html).toContain('Hola Ana');
    expect(out.html).toContain('<!doctype html>'); // mjml emite documento completo
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- email.renderer`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/renderers/email.renderer.ts
import { Injectable } from '@nestjs/common';
import mjml2html from 'mjml';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateEngine } from '../template-engine';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';

@Injectable()
export class EmailRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'email';

  constructor(private readonly engine: TemplateEngine) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    const subject = this.engine.render(version.subject ?? '', ctx);
    const rendered = this.engine.render(version.compiledBody ?? '', ctx);
    const html = rendered.includes('<mjml') ? mjml2html(rendered, { validationLevel: 'soft' }).html : rendered;
    return { format: 'email', mime: 'text/html', subject, html };
  }
}
```

> Nota: `mjml` requiere `esModuleInterop`/`allowSyntheticDefaultImports` (ya activos en el `tsconfig` de Nest). Si el import default fallara, usar `import * as mjml2html from 'mjml'` y llamar `(mjml2html as any)(...)`.

- [ ] **Step 4: Correr los tests**

Run: `npm test -- email.renderer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/renderers/email.renderer.ts src/documents/renderers/email.renderer.spec.ts
git commit -m "feat(documents): EmailRenderer (Handlebars + compilación MJML)"
```

---

## Task 10: TemplateStore

**Files:**
- Create: `src/documents/template-store.service.ts`
- Create: `src/documents/template-store.service.spec.ts`

**Interfaces:**
- Consumes: repos `DocumentTemplate`, `DocumentTemplateVersion`.
- Produces: `TemplateStore.getActive(code: string): Promise<{ template: DocumentTemplate; version: DocumentTemplateVersion }>` (lanza si no hay plantilla activa o versión publicada); `TemplateStore.invalidate(code?: string): void`. Cachea por `code`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/template-store.service.spec.ts
import { TemplateStore } from './template-store.service';

function make(template: any, version: any) {
  const tplRepo: any = { findOne: jest.fn(() => Promise.resolve(template)) };
  const verRepo: any = { findOne: jest.fn(() => Promise.resolve(version)) };
  return { svc: new TemplateStore(tplRepo, verRepo), tplRepo, verRepo };
}

describe('TemplateStore', () => {
  it('carga plantilla activa + versión publicada', async () => {
    const { svc } = make(
      { id: 't1', code: 'route_dispatch', active: true, type: 'email', currentVersionId: 'v1' },
      { id: 'v1', status: 'published' },
    );
    const { template, version } = await svc.getActive('route_dispatch');
    expect(template.code).toBe('route_dispatch');
    expect(version.id).toBe('v1');
  });

  it('lanza si la plantilla no existe o está inactiva', async () => {
    const { svc } = make(null, null);
    await expect(svc.getActive('x')).rejects.toThrow();
  });

  it('cachea por code', async () => {
    const { svc, tplRepo } = make(
      { id: 't1', code: 'c', active: true, currentVersionId: 'v1' },
      { id: 'v1', status: 'published' },
    );
    await svc.getActive('c');
    await svc.getActive('c');
    expect(tplRepo.findOne).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- template-store`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/template-store.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';

interface ActiveTemplate { template: DocumentTemplate; version: DocumentTemplateVersion; }

@Injectable()
export class TemplateStore {
  private cache = new Map<string, ActiveTemplate>();

  constructor(
    @InjectRepository(DocumentTemplate) private readonly tplRepo: Repository<DocumentTemplate>,
    @InjectRepository(DocumentTemplateVersion) private readonly verRepo: Repository<DocumentTemplateVersion>,
  ) {}

  async getActive(code: string): Promise<ActiveTemplate> {
    const cached = this.cache.get(code);
    if (cached) return cached;

    const template = await this.tplRepo.findOne({ where: { code, active: true } });
    if (!template) throw new Error(`Plantilla '${code}' no existe o está inactiva`);
    if (!template.currentVersionId) throw new Error(`Plantilla '${code}' sin versión publicada`);

    const version = await this.verRepo.findOne({ where: { id: template.currentVersionId } });
    if (!version || version.status !== 'published') throw new Error(`Plantilla '${code}' sin versión publicada válida`);

    const result = { template, version };
    this.cache.set(code, result);
    return result;
  }

  invalidate(code?: string): void {
    if (code) this.cache.delete(code);
    else this.cache.clear();
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- template-store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/template-store.service.ts src/documents/template-store.service.spec.ts
git commit -m "feat(documents): TemplateStore (carga+cachea versión publicada)"
```

---

## Task 11: TemplateService.render() + renderPreview()

**Files:**
- Create: `src/documents/template.service.ts`
- Create: `src/documents/template.service.spec.ts`

**Interfaces:**
- Consumes: `TemplateStore.getActive()`, `RendererRegistry.get()`, `VariableResolver.build()`, `FallbackRenderer.render()`, repo `TemplateRenderLog`.
- Produces:
  - `TemplateService.render(code: string, data: Record<string, any>): Promise<RenderResult>` — NUNCA lanza; fallback en error.
  - `TemplateService.renderPreview(code: string, sampleData: Record<string, any>): Promise<RenderResult>` — igual que render pero pensado para preview.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/template.service.spec.ts
import { TemplateService } from './template.service';

function make(overrides: any = {}) {
  const store: any = { getActive: overrides.getActive ?? (() => Promise.resolve({ template: { type: 'email' }, version: { version: 2 } })) };
  const registry: any = { get: () => ({ render: () => Promise.resolve({ format: 'email', mime: 'text/html', html: '<p>ok</p>', subject: 'S' }) }) };
  const resolver: any = { build: () => Promise.resolve({ data: {}, brand: {}, system: {} }) };
  const fallback: any = { render: jest.fn(() => Promise.resolve({ format: 'email', mime: 'text/html', html: '<p>fb</p>', subject: 'FB' })) };
  const logRepo: any = { create: (x: any) => x, save: jest.fn(() => Promise.resolve()) };
  return { svc: new TemplateService(store, registry, resolver, fallback, logRepo), fallback, logRepo };
}

describe('TemplateService.render', () => {
  it('renderiza por el renderer correcto', async () => {
    const { svc } = make();
    const r = await svc.render('route_dispatch', { tracking: 'T' });
    expect(r.subject).toBe('S');
    expect(r.html).toContain('ok');
  });

  it('cae a fallback y NO lanza si el store falla', async () => {
    const { svc, fallback } = make({ getActive: () => Promise.reject(new Error('missing')) });
    const r = await svc.render('x', {});
    expect(fallback.render).toHaveBeenCalled();
    expect(r.html).toContain('fb');
  });

  it('registra un log de render', async () => {
    const { svc, logRepo } = make();
    await svc.render('c', {});
    expect(logRepo.save).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- template.service`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/template.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TemplateRenderLog, RenderStatus } from 'src/entities/template-render-log.entity';
import { TemplateStore } from './template-store.service';
import { RendererRegistry } from './renderer.registry';
import { VariableResolver } from './variable-resolver.service';
import { FallbackRenderer } from './fallback.renderer';
import { RenderResult } from './documents.types';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly store: TemplateStore,
    private readonly registry: RendererRegistry,
    private readonly resolver: VariableResolver,
    private readonly fallback: FallbackRenderer,
    @InjectRepository(TemplateRenderLog) private readonly logRepo: Repository<TemplateRenderLog>,
  ) {}

  async render(code: string, data: Record<string, any>): Promise<RenderResult> {
    const started = Date.now();
    try {
      const { template, version } = await this.store.getActive(code);
      const renderer = this.registry.get(template.type);
      const ctx = await this.resolver.build(template, data);
      const result = await renderer.render(version, ctx);
      void this.log(code, version.version, result.format, 'ok', started, data);
      return result;
    } catch (err: any) {
      this.logger.warn(`render(${code}) fallback: ${err?.message}`);
      const result = await this.fallback.render(code, data);
      void this.log(code, 0, result.format, 'fallback', started, data, err?.message);
      return result;
    }
  }

  async renderPreview(code: string, sampleData: Record<string, any>): Promise<RenderResult> {
    return this.render(code, sampleData);
  }

  private async log(code: string, version: number, format: string, status: RenderStatus, started: number, data: any, error?: string) {
    try {
      await this.logRepo.save(this.logRepo.create({
        code, version, format, status,
        entityId: data?.id ?? data?.entityId ?? null,
        ms: Date.now() - started,
        error: error ?? null,
      }));
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar render log: ${e?.message}`);
    }
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- template.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documents/template.service.ts src/documents/template.service.spec.ts
git commit -m "feat(documents): TemplateService.render() con fallback + render log"
```

---

## Task 12: DocumentsModule + registro de renderers

**Files:**
- Create: `src/documents/documents.module.ts`
- Modify: `src/app.module.ts` (importar `DocumentsModule`)

**Interfaces:**
- Consumes: todos los providers de Tasks 4–11; entidades de Task 1.
- Produces: `DocumentsModule` que exporta `TemplateService`. El array `DOCUMENT_RENDERERS` contiene `[EmailRenderer]` (Fase 1).

- [ ] **Step 1: Crear el módulo**

```ts
// src/documents/documents.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brand } from 'src/entities/brand.entity';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { TemplateRenderLog } from 'src/entities/template-render-log.entity';
import { TemplateEngine } from './template-engine';
import { BrandingService } from './branding.service';
import { VariableResolver } from './variable-resolver.service';
import { RendererRegistry } from './renderer.registry';
import { FallbackRenderer } from './fallback.renderer';
import { TemplateStore } from './template-store.service';
import { TemplateService } from './template.service';
import { EmailRenderer } from './renderers/email.renderer';
import { DOCUMENT_RENDERERS } from './renderers/renderer.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Brand, DocumentTemplate, DocumentTemplateVersion, TemplateVariableDef, TemplateRenderLog,
    ]),
  ],
  providers: [
    TemplateEngine,
    BrandingService,
    VariableResolver,
    FallbackRenderer,
    TemplateStore,
    TemplateService,
    EmailRenderer,
    { provide: DOCUMENT_RENDERERS, useFactory: (email: EmailRenderer) => [email], inject: [EmailRenderer] },
    RendererRegistry,
  ],
  exports: [TemplateService, BrandingService, TemplateStore],
})
export class DocumentsModule {}
```

- [ ] **Step 2: Importar en `app.module.ts`**

Añadir `DocumentsModule` al array `imports` de `AppModule` (junto a los demás módulos de feature). Import:

```ts
import { DocumentsModule } from './documents/documents.module';
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila; la app arranca resolviendo `TemplateService`.

- [ ] **Step 4: Commit**

```bash
git add src/documents/documents.module.ts src/app.module.ts
git commit -m "feat(documents): DocumentsModule + registro de EmailRenderer"
```

---

## Task 13: TemplateAdminService (CRUD, versionado, restore, brand)

**Files:**
- Create: `src/documents/admin/template-admin.service.ts`
- Create: `src/documents/admin/template-admin.service.spec.ts`
- Modify: `src/documents/documents.module.ts` (registrar el provider)

**Interfaces:**
- Consumes: repos `DocumentTemplate`, `DocumentTemplateVersion`, `Brand`; `TemplateStore.invalidate()`, `BrandingService.invalidate()`.
- Produces:
  - `createTemplate(input: { code; name; type; description?; category? }): Promise<DocumentTemplate>`
  - `saveDraft(templateId: string, input: { subject?; designJson?; compiledBody?; changelog? }, actor: { id?; name? }): Promise<DocumentTemplateVersion>` (crea o actualiza el borrador — la versión con status 'draft' de mayor número)
  - `publish(templateId: string, versionId: string, actor): Promise<DocumentTemplate>` (marca versión 'published', archiva la anterior, setea `currentVersionId`, invalida cachés)
  - `restore(templateId: string, fromVersionId: string, actor): Promise<DocumentTemplateVersion>` (clona en un nuevo borrador)
  - `listVersions(templateId: string): Promise<DocumentTemplateVersion[]>`
  - `getBrand(): Promise<Brand>` / `upsertBrand(input, actor): Promise<Brand>` (invalida BrandingService)

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/admin/template-admin.service.spec.ts
import { TemplateAdminService } from './template-admin.service';

function make() {
  const versions: any[] = [];
  const templates: any[] = [{ id: 't1', code: 'c', currentVersionId: null }];
  const tplRepo: any = {
    findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.id === where.id) ?? null),
    create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }),
    save: (t: any) => { const i = templates.findIndex((x) => x.id === t.id); if (i >= 0) templates[i] = t; else templates.push(t); return Promise.resolve(t); },
  };
  const verRepo: any = {
    find: () => Promise.resolve(versions),
    findOne: ({ where }: any) => Promise.resolve(versions.find((v) => v.id === where.id) ?? null),
    create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }),
    save: (v: any) => { const i = versions.findIndex((x) => x.id === v.id); if (i >= 0) versions[i] = v; else versions.push(v); return Promise.resolve(v); },
  };
  const brandRepo: any = { findOne: () => Promise.resolve(null), create: (d: any) => d, save: (b: any) => Promise.resolve({ id: 'b1', ...b }) };
  const store: any = { invalidate: jest.fn() };
  const branding: any = { invalidate: jest.fn() };
  return { svc: new TemplateAdminService(tplRepo, verRepo, brandRepo, store, branding), versions, templates, store, branding };
}

describe('TemplateAdminService', () => {
  it('saveDraft crea la versión 1 como draft', async () => {
    const { svc, versions } = make();
    const v = await svc.saveDraft('t1', { subject: 'S', compiledBody: '<p>x</p>' }, { id: 'u1', name: 'Ana' });
    expect(v.version).toBe(1);
    expect(v.status).toBe('draft');
    expect(versions).toHaveLength(1);
  });

  it('publish setea currentVersionId e invalida caché', async () => {
    const { svc, store, templates } = make();
    const v = await svc.saveDraft('t1', { compiledBody: '<p>x</p>' }, {});
    await svc.publish('t1', v.id, {});
    expect(templates[0].currentVersionId).toBe(v.id);
    expect(store.invalidate).toHaveBeenCalledWith('c');
  });

  it('restore clona una versión previa en un nuevo draft', async () => {
    const { svc } = make();
    const v1 = await svc.saveDraft('t1', { subject: 'Orig', compiledBody: '<p>1</p>' }, {});
    const restored = await svc.restore('t1', v1.id, {});
    expect(restored.subject).toBe('Orig');
    expect(restored.version).toBe(2);
    expect(restored.status).toBe('draft');
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- template-admin`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/admin/template-admin.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate, DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { Brand } from 'src/entities/brand.entity';
import { TemplateStore } from '../template-store.service';
import { BrandingService } from '../branding.service';

type Actor = { id?: string; name?: string };

@Injectable()
export class TemplateAdminService {
  constructor(
    @InjectRepository(DocumentTemplate) private readonly tplRepo: Repository<DocumentTemplate>,
    @InjectRepository(DocumentTemplateVersion) private readonly verRepo: Repository<DocumentTemplateVersion>,
    @InjectRepository(Brand) private readonly brandRepo: Repository<Brand>,
    private readonly store: TemplateStore,
    private readonly branding: BrandingService,
  ) {}

  createTemplate(input: { code: string; name: string; type: DocumentFormat; description?: string; category?: string }) {
    return this.tplRepo.save(this.tplRepo.create({ ...input, language: 'es', active: true }));
  }

  private async require(templateId: string): Promise<DocumentTemplate> {
    const t = await this.tplRepo.findOne({ where: { id: templateId } });
    if (!t) throw new NotFoundException(`Plantilla ${templateId} no existe`);
    return t;
  }

  private async nextVersionNumber(templateId: string): Promise<number> {
    const all = await this.verRepo.find({ where: { templateId } });
    return all.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  }

  async saveDraft(templateId: string, input: { subject?: string; designJson?: any; compiledBody?: string; changelog?: string }, actor: Actor) {
    await this.require(templateId);
    const all = await this.verRepo.find({ where: { templateId } });
    const draft = all.filter((v) => v.status === 'draft').sort((a, b) => b.version - a.version)[0];
    if (draft) {
      Object.assign(draft, {
        subject: input.subject ?? draft.subject,
        designJson: input.designJson ?? draft.designJson,
        compiledBody: input.compiledBody ?? draft.compiledBody,
        changelog: input.changelog ?? draft.changelog,
      });
      return this.verRepo.save(draft);
    }
    return this.verRepo.save(this.verRepo.create({
      templateId,
      version: await this.nextVersionNumber(templateId),
      status: 'draft',
      subject: input.subject ?? null,
      designJson: input.designJson ?? null,
      compiledBody: input.compiledBody ?? null,
      engine: 'handlebars',
      changelog: input.changelog ?? null,
      createdById: actor.id ?? null,
      createdByName: actor.name ?? null,
    }));
  }

  async publish(templateId: string, versionId: string, _actor: Actor) {
    const template = await this.require(templateId);
    const version = await this.verRepo.findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException(`Versión ${versionId} no existe`);

    if (template.currentVersionId) {
      const prev = await this.verRepo.findOne({ where: { id: template.currentVersionId } });
      if (prev && prev.status === 'published') { prev.status = 'archived'; await this.verRepo.save(prev); }
    }
    version.status = 'published';
    version.publishedAt = new Date();
    await this.verRepo.save(version);

    template.currentVersionId = version.id;
    await this.tplRepo.save(template);
    this.store.invalidate(template.code);
    return template;
  }

  async restore(templateId: string, fromVersionId: string, actor: Actor) {
    await this.require(templateId);
    const from = await this.verRepo.findOne({ where: { id: fromVersionId } });
    if (!from) throw new NotFoundException(`Versión ${fromVersionId} no existe`);
    return this.verRepo.save(this.verRepo.create({
      templateId,
      version: await this.nextVersionNumber(templateId),
      status: 'draft',
      subject: from.subject,
      designJson: from.designJson,
      compiledBody: from.compiledBody,
      engine: from.engine,
      changelog: `Restaurado desde v${from.version}`,
      createdById: actor.id ?? null,
      createdByName: actor.name ?? null,
    }));
  }

  listVersions(templateId: string) {
    return this.verRepo.find({ where: { templateId }, order: { version: 'DESC' } });
  }

  list() {
    return this.tplRepo.find({ order: { code: 'ASC' } });
  }

  getByCode(code: string) {
    return this.tplRepo.findOne({ where: { code } });
  }

  async getBrand() {
    return (await this.brandRepo.findOne({ where: { key: 'default' } })) ?? this.brandRepo.create({ key: 'default' });
  }

  async upsertBrand(input: Partial<Brand>, _actor: Actor) {
    const existing = await this.brandRepo.findOne({ where: { key: 'default' } });
    const row = existing ? Object.assign(existing, input) : this.brandRepo.create({ ...input, key: 'default' });
    row.updatedAt = new Date();
    const saved = await this.brandRepo.save(row);
    this.branding.invalidate();
    return saved;
  }
}
```

- [ ] **Step 4: Registrar el provider**

En `documents.module.ts` añadir `TemplateAdminService` a `providers` y a `exports`, e importarlo.

- [ ] **Step 5: Correr los tests + build**

Run: `npm test -- template-admin && npm run build`
Expected: PASS (3 tests); build OK.

- [ ] **Step 6: Commit**

```bash
git add src/documents/admin/template-admin.service.ts src/documents/admin/template-admin.service.spec.ts src/documents/documents.module.ts
git commit -m "feat(documents): TemplateAdminService (CRUD, versionado, publish, restore, brand)"
```

---

## Task 14: Controllers + DTOs (admin)

**Files:**
- Create: `src/documents/admin/dto/template.dto.ts`
- Create: `src/documents/admin/templates.controller.ts`
- Create: `src/documents/admin/brand.controller.ts`
- Modify: `src/documents/documents.module.ts` (registrar controllers)

**Interfaces:**
- Consumes: `TemplateAdminService` (Task 13), `TemplateService` (Task 11), `MailService` (existente, para test-send), `SuperAdminGuard`.
- Produces: rutas REST bajo `api/documents/*` y `api/documents/brand`.

- [ ] **Step 1: Crear los DTOs**

```ts
// src/documents/admin/dto/template.dto.ts
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentFormat } from 'src/entities/document-template.entity';

const FORMATS = ['email', 'pdf', 'excel', 'report', 'letter', 'receipt', 'label', 'statement'];

export class CreateTemplateDto {
  @IsString() @MaxLength(80) code: string;
  @IsString() @MaxLength(160) name: string;
  @IsIn(FORMATS) type: DocumentFormat;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
}

export class SaveDraftDto {
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsObject() designJson?: any;
  @IsOptional() @IsString() compiledBody?: string;
  @IsOptional() @IsString() @MaxLength(500) changelog?: string;
}

export class PublishDto { @IsString() versionId: string; }
export class RestoreDto { @IsString() fromVersionId: string; }

export class TestSendDto {
  @IsString() to: string;
  @IsOptional() @IsObject() sampleData?: Record<string, any>;
}

export class PreviewDto { @IsOptional() @IsObject() sampleData?: Record<string, any>; }

export class UpsertBrandDto {
  @IsOptional() @IsString() logoLight?: string;
  @IsOptional() @IsString() logoDark?: string;
  @IsOptional() @IsObject() colors?: Record<string, string>;
  @IsOptional() @IsObject() typography?: Record<string, string>;
  @IsOptional() @IsString() borderRadius?: string;
  @IsOptional() @IsObject() spacing?: Record<string, string>;
  @IsOptional() @IsObject() fiscal?: Record<string, string>;
  @IsOptional() @IsObject() contact?: Record<string, string>;
  @IsOptional() @IsObject() social?: Record<string, string>;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 2: Crear `templates.controller.ts`**

```ts
// src/documents/admin/templates.controller.ts
import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { MailService } from 'src/mail/mail.service';
import { TemplateAdminService } from './template-admin.service';
import { TemplateService } from '../template.service';
import { CreateTemplateDto, SaveDraftDto, PublishDto, RestoreDto, TestSendDto, PreviewDto } from './dto/template.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('documents/templates')
export class TemplatesController {
  constructor(
    private readonly admin: TemplateAdminService,
    private readonly templates: TemplateService,
    private readonly mail: MailService,
  ) {}

  @Get() list() { return this.admin.list(); }

  @Get(':code') getByCode(@Param('code') code: string) { return this.admin.getByCode(code); }

  @Post() create(@Body() dto: CreateTemplateDto) { return this.admin.createTemplate(dto); }

  @Post(':id/draft')
  saveDraft(@Param('id') id: string, @Body() dto: SaveDraftDto, @Request() req) {
    return this.admin.saveDraft(id, dto, { id: req.user?.userId, name: req.user?.name });
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() dto: PublishDto, @Request() req) {
    return this.admin.publish(id, dto.versionId, { id: req.user?.userId, name: req.user?.name });
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Body() dto: RestoreDto, @Request() req) {
    return this.admin.restore(id, dto.fromVersionId, { id: req.user?.userId, name: req.user?.name });
  }

  @Get(':id/versions') versions(@Param('id') id: string) { return this.admin.listVersions(id); }

  @Post(':code/preview')
  preview(@Param('code') code: string, @Body() dto: PreviewDto) {
    return this.templates.renderPreview(code, dto.sampleData ?? {});
  }

  @Post(':code/test-send')
  async testSend(@Param('code') code: string, @Body() dto: TestSendDto) {
    const r = await this.templates.renderPreview(code, dto.sampleData ?? {});
    await this.mail.sendEmailNotification({ to: dto.to, subject: r.subject ?? 'Prueba PMY', htmlContent: r.html ?? '' });
    return { ok: true };
  }
}
```

- [ ] **Step 3: Crear `brand.controller.ts`**

```ts
// src/documents/admin/brand.controller.ts
import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { TemplateAdminService } from './template-admin.service';
import { UpsertBrandDto } from './dto/template.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('documents/brand')
export class BrandController {
  constructor(private readonly admin: TemplateAdminService) {}

  @Get() get() { return this.admin.getBrand(); }

  @Put()
  upsert(@Body() dto: UpsertBrandDto, @Request() req) {
    return this.admin.upsertBrand(dto, { id: req.user?.userId, name: req.user?.name });
  }
}
```

- [ ] **Step 4: Registrar controllers + importar MailModule**

En `documents.module.ts`: añadir `controllers: [TemplatesController, BrandController]`, importar `MailModule` en `imports` (para inyectar `MailService`). Verificar que `MailModule` exporte `MailService`; si no, añadir `exports: [MailService]` a `src/mail/mail.module.ts`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compila; rutas disponibles bajo `api/documents/*`.

- [ ] **Step 6: Commit**

```bash
git add src/documents/admin/ src/documents/documents.module.ts src/mail/mail.module.ts
git commit -m "feat(documents): controllers admin (templates + brand) bajo SuperAdminGuard"
```

---

## Task 15: Seed idempotente de correos actuales

**Files:**
- Create: `src/documents/seeds/email-templates.seed.ts`
- Create: `src/documents/seeds/email-templates.seed.spec.ts`

**Interfaces:**
- Consumes: repos `DocumentTemplate`, `DocumentTemplateVersion`, `TemplateVariableDef`.
- Produces: `seedEmailTemplates(repos): Promise<void>` — upsert por `code` (idempotente); crea plantilla + versión publicada v1 + variable defs para cada correo del inventario (§9 del spec). Exporta `EMAIL_TEMPLATE_SEEDS` (array de definiciones).

- [ ] **Step 1: Escribir el test que falla (idempotencia)**

```ts
// src/documents/seeds/email-templates.seed.spec.ts
import { seedEmailTemplates, EMAIL_TEMPLATE_SEEDS } from './email-templates.seed';

function repos() {
  const templates: any[] = []; const versions: any[] = []; const vars: any[] = [];
  return {
    tplRepo: {
      findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.code === where.code) ?? null),
      create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }),
      save: (t: any) => { if (!templates.find((x) => x.id === t.id)) templates.push(t); return Promise.resolve(t); },
    },
    verRepo: {
      findOne: ({ where }: any) => Promise.resolve(versions.find((v) => v.templateId === where.templateId && v.version === where.version) ?? null),
      create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }),
      save: (v: any) => { if (!versions.find((x) => x.id === v.id)) versions.push(v); return Promise.resolve(v); },
    },
    varRepo: {
      find: ({ where }: any) => Promise.resolve(vars.filter((x) => x.templateId === where.templateId)),
      create: (d: any) => d,
      save: (arr: any[]) => { vars.push(...arr); return Promise.resolve(arr); },
    },
    _state: { templates, versions, vars },
  };
}

describe('seedEmailTemplates', () => {
  it('crea una plantilla por cada correo del inventario', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    expect(r._state.templates.length).toBe(EMAIL_TEMPLATE_SEEDS.length);
    expect(r._state.templates.every((t) => t.currentVersionId)).toBe(true);
  });

  it('es idempotente: correrlo dos veces no duplica', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    await seedEmailTemplates(r as any);
    expect(r._state.templates.length).toBe(EMAIL_TEMPLATE_SEEDS.length);
  });

  it('incluye route_dispatch con sus variables', async () => {
    const seed = EMAIL_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch');
    expect(seed).toBeDefined();
    expect(seed!.variables.map((v) => v.name)).toEqual(
      expect.arrayContaining(['subsidiaryName', 'vehicleName', 'createdAt', 'drivers', 'routes', 'trackingNumber']),
    );
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- email-templates.seed`
Expected: FAIL.

- [ ] **Step 3: Implementar el seed**

```ts
// src/documents/seeds/email-templates.seed.ts
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';

export interface EmailSeedVar { name: string; label: string; dataType?: string; example?: string; required?: boolean; }
export interface EmailSeed { code: string; name: string; subject: string; body: string; variables: EmailSeedVar[]; }

/** Cuerpo MJML base branded reutilizable. `{{{content}}}` recibe HTML del bloque específico. */
const wrap = (content: string) => `<mjml><mj-body background-color="#f4f4f4">
  <mj-section background-color="#ffffff"><mj-column>
    <mj-text font-size="18px" font-weight="bold" color="{{brand.colors.secondary}}">{{brand.fiscal.razonSocial}}</mj-text>
    ${content}
    <mj-divider border-color="#eeeeee" />
    <mj-text font-size="12px" color="#7f8c8d">Este correo fue enviado automáticamente por el sistema. Por favor, no responda a este mensaje.<br/>{{brand.contact.website}}</mj-text>
  </mj-column></mj-section>
</mj-body></mjml>`;

/** Inventario de correos (spec §9). Paridad: cada variable actual está declarada. */
export const EMAIL_TEMPLATE_SEEDS: EmailSeed[] = [
  {
    code: 'route_dispatch',
    name: 'Salida a Ruta',
    subject: 'Salida a ruta - {{driverName}} - {{formatDate createdAt}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Salida a Ruta</mj-text>
      <mj-text>Se generó un reporte de <b>Salida a Ruta</b> para la sucursal <b>{{subsidiaryName}}</b> en la unidad <b>{{vehicleName}}</b>.</mj-text>
      <mj-text><b>Fecha y hora:</b> {{formatDate createdAt}}<br/><b>Responsable(s):</b> {{drivers}}<br/><b>Ruta(s):</b> {{routes}}<br/><b>Seguimiento:</b> {{trackingNumber}}</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'drivers', label: 'Responsables' },
      { name: 'routes', label: 'Rutas' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'driverName', label: 'Chofer principal' },
    ],
  },
  {
    code: 'unloading',
    name: 'Desembarque',
    subject: '🚚 Desembarque {{formatDate createdAt}} de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Desembarque</mj-text>
      <mj-text>Se generó un reporte de <b>Desembarque</b> para la sucursal <b>{{subsidiaryName}}</b> descargado de la unidad <b>{{vehicleName}}</b>.</mj-text>
      <mj-text><b>Fecha y hora:</b> {{formatDate createdAt}}<br/><b>Seguimiento:</b> {{trackingNumber}}</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
    ],
  },
  {
    code: 'route_closure',
    name: 'Cierre de Ruta',
    subject: '🚚 CIERRE DE RUTA - {{driverName}} - {{formatDate createdAt}} DE {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Cierre de Ruta</mj-text>
      <mj-text>Se generó un reporte de <b>Cierre de Ruta</b> para la sucursal <b>{{subsidiaryName}}</b>.</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'driverName', label: 'Chofer' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
    ],
  },
  {
    code: 'inventory_report',
    name: 'Inventario',
    subject: '📦 Inventario {{formatDate inventoryDate}} de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">📦 Reporte de Inventario</mj-text>
      <mj-text>Se generó un reporte de <b>Inventario</b> para la sucursal <b>{{subsidiaryName}}</b>.</mj-text>
      <mj-text><b>Fecha:</b> {{formatDate inventoryDate}}<br/><b>Seguimiento:</b> {{trackingNumber}}</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'inventoryDate', label: 'Fecha de inventario', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
    ],
  },
  {
    code: 'devolutions',
    name: 'Devoluciones/Recolecciones',
    subject: '🚚 Devoluciones/Recolecciones {{formatDate createdAt}} de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Devoluciones/Recolecciones</mj-text>
      <mj-text>Se generó un reporte de <b>Devoluciones/Recolecciones</b> para la sucursal <b>{{subsidiaryName}}</b>.</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
    ],
  },
  {
    code: 'dex03_report',
    name: 'Paquetes con status DEX03',
    subject: '🚨🚥 Paquetes con status DEX03 de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Reporte de Paquetes con DEX03 — {{subsidiaryName}}</mj-text>
      <mj-text>Se detectaron los siguientes envíos con status DEX03. Considere la fecha de recepción ({{formatDate today}}) para su seguimiento.</mj-text>
      <mj-table><tr style="text-align:left;border-bottom:1px solid #ddd"><th>Tracking</th><th>Nombre</th><th>Dirección</th><th>CP</th><th>Fecha</th><th>Por</th><th>Teléfono</th></tr>
      {{#each rows}}<tr><td>{{this.trackingNumber}}</td><td>{{this.recipientName}}</td><td>{{this.recipientAddress}}</td><td>{{this.recipientZip}}</td><td>{{this.timestamp}}</td><td>{{this.doItByUser}}</td><td>{{this.recipientPhone}}</td></tr>{{/each}}
      </mj-table>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'today', label: 'Fecha del reporte', dataType: 'date' },
      { name: 'rows', label: 'Filas (envíos DEX03)' },
    ],
  },
  {
    code: 'high_priority_shipments',
    name: 'Envíos Prioridad Alta en Curso',
    subject: '🔴 Envíos con Prioridad Alta en Curso',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Envíos con Prioridad Alta en Curso</mj-text>
      <mj-raw>{{{tableHtml}}}</mj-raw>`),
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }],
  },
  {
    code: 'unloading_priority_packages',
    name: 'Envíos Prioridad Alta en Descarga',
    subject: '🔴 Envíos con Prioridad Alta en Descarga',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Envíos con Prioridad Alta en Descarga</mj-text>
      <mj-raw>{{{tableHtml}}}</mj-raw>`),
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }],
  },
  {
    code: 'inventory_priority_packages',
    name: 'Envíos Prioridad Alta en Inventario',
    subject: '🔴 Envíos con Prioridad Alta en Inventario',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Envíos con Prioridad Alta en Inventario</mj-text>
      <mj-raw>{{{tableHtml}}}</mj-raw>`),
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }],
  },
  {
    code: 'password_reset_otp',
    name: 'Código de recuperación (OTP)',
    subject: 'Tu código de recuperación: {{code}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold">Recuperación de contraseña — PMY App</mj-text>
      <mj-text>Usa este código para restablecer tu contraseña. Vence en {{minutes}} minutos.</mj-text>
      <mj-text align="center" font-size="32px" font-weight="bold" letter-spacing="8px">{{code}}</mj-text>
      <mj-text color="#94a3b8" font-size="12px">Si no solicitaste este código, ignora este correo.</mj-text>`),
    variables: [
      { name: 'code', label: 'Código OTP', required: true },
      { name: 'minutes', label: 'Minutos de vigencia', dataType: 'number' },
    ],
  },
  {
    code: 'password_reset_link',
    name: 'Restablecer contraseña (enlace)',
    subject: 'Password Reset Request',
    body: wrap(`<mj-text>Para restablecer tu contraseña, haz clic en el siguiente enlace:</mj-text>
      <mj-button href="{{resetLink}}" background-color="{{brand.colors.button}}">Restablecer contraseña</mj-button>`),
    variables: [{ name: 'resetLink', label: 'Enlace de restablecimiento', required: true }],
  },
  {
    code: 'generic_notification',
    name: 'Notificación genérica',
    subject: '{{title}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold">{{title}}</mj-text>
      <mj-text>{{body}}</mj-text>
      {{#if link}}<mj-button href="{{link}}" background-color="{{brand.colors.button}}">Abrir en PMY</mj-button>{{/if}}`),
    variables: [
      { name: 'title', label: 'Título' },
      { name: 'body', label: 'Cuerpo' },
      { name: 'link', label: 'Enlace' },
    ],
  },
];

interface SeedRepos {
  tplRepo: Repository<DocumentTemplate>;
  verRepo: Repository<DocumentTemplateVersion>;
  varRepo: Repository<TemplateVariableDef>;
}

/** Upsert idempotente por `code`. Si la plantilla ya existe, no la duplica. */
export async function seedEmailTemplates(repos: SeedRepos): Promise<void> {
  for (const seed of EMAIL_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) {
      template = await repos.tplRepo.save(repos.tplRepo.create({
        code: seed.code, name: seed.name, type: 'email', language: 'es', active: true, category: 'correo',
      }));
    }
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) {
      version = await repos.verRepo.save(repos.verRepo.create({
        templateId: template.id, version: 1, status: 'published',
        subject: seed.subject, compiledBody: seed.body, engine: 'handlebars',
        changelog: 'Seed inicial (paridad con código legacy)', publishedAt: new Date(),
      }));
    }
    if (!template.currentVersionId) {
      template.currentVersionId = version.id;
      await repos.tplRepo.save(template);
    }
    const existingVars = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existingVars.length === 0) {
      await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({
        templateId: template.id, name: v.name, label: v.label,
        dataType: (v.dataType as any) ?? 'string', example: v.example ?? null, required: v.required ?? false,
      })));
    }
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- email-templates.seed`
Expected: PASS (3 tests).

- [ ] **Step 5: Enganchar el seed al arranque de seed existente**

En `src/seed/seed.ts`, tras inicializar el DataSource, llamar `seedEmailTemplates` con los repos del DataSource. (Seguir el patrón del archivo; importar la función y los 3 repos.) Si el proyecto no ejecuta `src/seed/seed.ts` en producción, documentar que se corre con `npm run seed`.

- [ ] **Step 6: Commit**

```bash
git add src/documents/seeds/ src/seed/seed.ts
git commit -m "feat(documents): seed idempotente de los correos actuales (paridad de variables)"
```

---

## Task 16: Migrar correos transaccionales de MailService a render()

**Files:**
- Modify: `src/mail/mail.service.ts`
- Modify: `src/mail/mail.module.ts` (importar `DocumentsModule` para inyectar `TemplateService`)
- Create: `src/mail/mail.service.spec.ts`

**Interfaces:**
- Consumes: `TemplateService.render(code, data)`.
- Produces: los métodos `sendHighPriority*` construyen el HTML/subject vía `TemplateService.render()` en lugar de literales; conservan `applyDevFilters`, destinatarios y adjuntos (PDF/Excel legacy).

- [ ] **Step 1: Escribir el test que falla (route_dispatch usa render)**

```ts
// src/mail/mail.service.spec.ts
import { MailService } from './mail.service';

function make() {
  const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
  const config: any = { get: () => 'production' };
  const templates: any = { render: jest.fn(() => Promise.resolve({ subject: 'Salida a ruta - Juan', html: '<p>ok</p>' })) };
  const svc = new MailService(mailer, config, templates);
  return { svc, mailer, templates };
}

describe('MailService.sendHighPriorityPackageDispatchEmail', () => {
  it('renderiza el correo por plantilla route_dispatch y lo envía', async () => {
    const { svc, mailer, templates } = make();
    const pd: any = { vehicle: { name: 'V1' }, drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }], trackingNumber: 'T1', createdAt: new Date(), subsidiary: { officeEmail: 'a@x.com', officeEmailToCopy: 'b@x.com' } };
    const pdf: any = { originalname: 'r.pdf', buffer: Buffer.from('x') };
    const xls: any = { originalname: 'r.xlsx', buffer: Buffer.from('y') };
    await svc.sendHighPriorityPackageDispatchEmail(pdf, xls, 'Sucursal X', pd);
    expect(templates.render).toHaveBeenCalledWith('route_dispatch', expect.objectContaining({ subsidiaryName: 'Sucursal X', trackingNumber: 'T1' }));
    expect(mailer.sendMail).toHaveBeenCalled();
    const arg = mailer.sendMail.mock.calls[0][0];
    expect(arg.html).toContain('ok');
    expect(arg.attachments).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- mail.service`
Expected: FAIL (constructor arity: falta `TemplateService`).

- [ ] **Step 3: Inyectar TemplateService y migrar `route_dispatch`**

En `mail.service.ts`, añadir al constructor (tras `configService`):

```ts
    private readonly templates: TemplateService,
```

Import: `import { TemplateService } from 'src/documents/template.service';`

Reemplazar el cuerpo de `sendHighPriorityPackageDispatchEmail` (conservando adjuntos + destinatarios + applyDevFilters):

```ts
  async sendHighPriorityPackageDispatchEmail(
    pdfFile: Express.Multer.File, excelFile: Express.Multer.File, subsidiaryName: string, packageDispatch: PackageDispatch,
  ) {
    const attachments = [
      { filename: pdfFile.originalname, content: pdfFile.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];
    const rendered = await this.templates.render('route_dispatch', {
      subsidiaryName,
      vehicleName: packageDispatch.vehicle?.name ?? 'N/A',
      createdAt: packageDispatch.createdAt,
      drivers: packageDispatch.drivers.map((d) => d.name).join(' - '),
      routes: packageDispatch.routes.map((r) => r.name).join(' -> '),
      trackingNumber: packageDispatch.trackingNumber,
      driverName: packageDispatch.drivers?.[0]?.name ?? 'Sin chofer',
    });
    const { to, cc } = this.applyDevFilters(
      packageDispatch.subsidiary.officeEmail,
      `${packageDispatch.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`,
    );
    try {
      await this.mailerService.sendMail({ to, cc, subject: rendered.subject, html: rendered.html, attachments });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
```

- [ ] **Step 4: Importar DocumentsModule en MailModule**

`src/mail/mail.module.ts` está incompleto (un `forRoot` suelto). Convertirlo en un `@Module` propio o —si `MailService` se provee en otro módulo— asegurar que ese módulo importe `DocumentsModule` y que `DocumentsModule` exporte `TemplateService` (ya lo hace, Task 12). Localizar dónde se declara `MailService` como provider (`grep -rn "providers.*MailService" src`) y añadir `DocumentsModule` a los `imports` de ese módulo.

- [ ] **Step 5: Migrar los demás transaccionales (mismo patrón, distinta data)**

Aplicar la misma transformación a estos métodos, mapeando su data al `code` correspondiente y conservando adjuntos + destinatarios:

- `sendHighPriorityUnloadingEmail` → `render('unloading', { subsidiaryName, vehicleName: unloading.vehicle?.name, createdAt: unloading.createdAt, trackingNumber: unloading.trackingNumber })`
- `sendHighPriorityRouteClosureEmail` → `render('route_closure', { subsidiaryName: routeClosure.subsidiary.name, driverName: routeClosure.packageDispatch.drivers[0]?.name, createdAt: new Date() })`
- `sendHighPriorityInventoryEmail` → `render('inventory_report', { subsidiaryName, inventoryDate: inventory.inventoryDate, trackingNumber: inventory.trackingNumber })`
- `sendHighPriorityDevolutionsEmail` → `render('devolutions', { subsidiaryName: subsidiary.name, createdAt: new Date() })`
- `sendHighPriorityShipmentWithStatus03` → `render('dex03_report', { subsidiaryName: subsidiary.name, today: new Date(), rows: shipments.map(s => ({ trackingNumber: s.trackingNumber, recipientName: s.recipientName, recipientAddress: s.recipientAddress, recipientZip: s.recipientZip, timestamp: formatToHermosillo(s.timestamp), doItByUser: s.doItByUser, recipientPhone: this.formatMexicanPhoneNumber(s.recipientPhone) })) })` — conservar los headers de alta prioridad en `sendMail`.

En cada uno: subject/html salen de `rendered`; se elimina el `htmlContent` literal.

- [ ] **Step 6: Correr tests + build**

Run: `npm test -- mail.service && npm run build`
Expected: PASS; build OK.

- [ ] **Step 7: Commit**

```bash
git add src/mail/mail.service.ts src/mail/mail.service.spec.ts src/mail/mail.module.ts
git commit -m "refactor(mail): correos transaccionales renderizados por el motor de plantillas"
```

---

## Task 17: Migrar correos de auth + notificación genérica

**Files:**
- Modify: `src/auth/email.service.ts`
- Modify: `src/auth/auth.module.ts` (importar `DocumentsModule`)
- Modify: `src/notifications/notification-dispatch.service.ts` (usar `generic_notification`)
- Create: `src/auth/email.service.spec.ts`

**Interfaces:**
- Consumes: `TemplateService.render()`.
- Produces: `sendPasswordResetEmail` y `sendOtpEmail` renderizan por plantilla; `NotificationDispatchService.buildEmailHtml` usa `generic_notification` (con fallback al HTML actual si render falla — que ya lo garantiza el motor).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/auth/email.service.spec.ts
import { EmailService } from './email.service';

describe('EmailService (plantillas)', () => {
  it('sendOtpEmail renderiza password_reset_otp', async () => {
    const templates: any = { render: jest.fn(() => Promise.resolve({ subject: 'Tu código: 123456', html: '<p>123456</p>' })) };
    const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
    const svc = new EmailService(templates, mailer);
    await svc.sendOtpEmail('u@x.com', '123456', 10);
    expect(templates.render).toHaveBeenCalledWith('password_reset_otp', { code: '123456', minutes: 10 });
    expect(mailer.sendMail).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- auth/email.service`
Expected: FAIL.

- [ ] **Step 3: Refactorizar `EmailService`**

`EmailService` hoy crea su propio `nodemailer` transport. Migrarlo a inyectar `TemplateService` + `MailerService` (transporte unificado):

```ts
// src/auth/email.service.ts
import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { TemplateService } from 'src/documents/template.service';

@Injectable()
export class EmailService {
  constructor(
    private readonly templates: TemplateService,
    private readonly mailer: MailerService,
  ) {}

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const r = await this.templates.render('password_reset_link', { resetLink });
    await this.mailer.sendMail({ to, subject: r.subject ?? 'Password Reset Request', html: r.html });
  }

  async sendOtpEmail(to: string, code: string, minutes = 10): Promise<void> {
    const r = await this.templates.render('password_reset_otp', { code, minutes });
    await this.mailer.sendMail({ to, subject: r.subject ?? `Tu código de recuperación: ${code}`, html: r.html });
  }
}
```

En `auth.module.ts`: añadir `DocumentsModule` a `imports` (para `TemplateService`) y confirmar que `MailerModule` esté disponible (ya lo usa el proyecto). Verificar que `EmailService` siga en `providers`.

- [ ] **Step 4: Notificación genérica por plantilla**

En `notification-dispatch.service.ts`, reemplazar el cuerpo de `buildEmailHtml(event)` por una llamada al motor (inyectar `TemplateService` en el constructor y añadir `DocumentsModule` a `NotificationsModule.imports`):

```ts
  private async renderEmail(event: NotificationEvent): Promise<{ subject: string; html: string }> {
    const link = event.link ? `${process.env.FRONTEND_URL ?? ''}${event.link}` : undefined;
    const r = await this.templates.render('generic_notification', { title: event.title, body: event.body, link });
    return { subject: r.subject ?? event.title ?? 'Notificación PMY', html: r.html ?? '' };
  }
```

Actualizar el `for` de envío de email para usar `await this.renderEmail(event)` (subject + html) en lugar de `buildEmailHtml`. Como `render()` nunca lanza, el fallback del motor ya cubre el error.

- [ ] **Step 5: Correr tests + build**

Run: `npm test -- auth/email.service && npm run build`
Expected: PASS; build OK.

- [ ] **Step 6: Commit**

```bash
git add src/auth/email.service.ts src/auth/auth.module.ts src/notifications/notification-dispatch.service.ts src/auth/email.service.spec.ts
git commit -m "refactor(auth,notifications): OTP/reset/notificación genérica por el motor de plantillas"
```

---

## Task 18: Verificación integral + graph

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: toda la suite en verde.

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 3: Verificación funcional (dev, opcional pero recomendada)**

Con `DB_SYNC=true` o migración aplicada + `npm run seed`, arrancar la API y hacer:
`POST /api/documents/templates/route_dispatch/preview` con `sampleData` de ejemplo → debe devolver `{ subject, html }` con las variables sustituidas. `POST /api/documents/templates/route_dispatch/test-send` con un `to` → llega el correo.

- [ ] **Step 4: Refrescar el grafo de código**

Run: `graphify update .`

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore(documents): verificación integral Fase 1 backend + refresh graphify"
```

---

## Self-Review (autor)

- **Cobertura del spec:** entidades §5.1 → T1/T2; contratos núcleo §6.1 → T3–T11; módulo §6 → T12; admin/versionado/restore/preview/test-send §6.2/§6.3 → T13/T14; seed + paridad §9/§10 → T15; migración de MailService §10 → T16/T17; criterios de aceptación §14 → T18. Editor GrapesJS/Brand UI y adjuntos PDF/Excel → **Plan 2 (frontend)** y **Fases 2/3** (fuera de este plan, como marca el spec §13).
- **Consistencia de tipos:** `render(code,data)`, `getActive(code)`, `build(template,data)`, `get(format)`, `render(version,ctx)` (renderers), `getTokens()`, `saveDraft/publish/restore` — nombres idénticos entre tareas.
- **Paridad:** los 12 `code` del inventario §9 están en `EMAIL_TEMPLATE_SEEDS` (T15) con sus variables; T16/T17 los conectan preservando adjuntos y destinatarios.
- **Riesgo conocido:** `mail.module.ts` está incompleto en el repo; T16 Step 4 lo resuelve localizando el provider real de `MailService`. Las tablas MJML de "priority packages" usan `{{{tableHtml}}}` (HTML del llamador) para no perder columnas hasta que se modelen como filas estructuradas en una iteración posterior.
