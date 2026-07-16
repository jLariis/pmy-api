# Motor de Plantillas — Fase 3 Etapa 1: Núcleo de bloques + Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir el modelo de contenido por **bloques** (`EmailDoc`) y un `BlockComposer` (bloques → MJML), refactorizar `EmailRenderer` para componer desde `designJson`, y re-sembrar los 12 correos como bloques — dejando la base para el editor guiado (Etapa 2) y para PDF/Excel (Etapas 3-4).

**Architecture:** Un `BlockComposer` puro convierte un `EmailDoc` (lista de bloques) en un string MJML con placeholders `{{var}}` y `{{brand.*}}` intactos (los interpola el `TemplateEngine` de Fase 1). `EmailRenderer` compone desde `version.designJson` (EmailDoc) con fallback al `compiledBody` MJML legacy. El seed guarda `designJson` (bloques) + `compiledBody` (MJML compuesto, para caché/preview).

**Tech Stack:** NestJS, TypeORM, Handlebars + MJML (Fase 1), Jest.

## Global Constraints

- Trabajar en `D:\PMY\pmy-api`, branch **`feat/template-engine-phase3`** (ya creado; NO mergear a main).
- El motor está en `src/documents/` (Fase 1). Reusar `TemplateEngine` (`src/documents/template-engine.ts`, método `render(source, ctx)` que corre Handlebars) y el flujo MJML async de `EmailRenderer` (`mjml2html` vía `import mjml2html = require('mjml')`, `validationLevel:'soft'`).
- `BlockComposer.compose(doc)` NO interpola variables ni marca: emite MJML con placeholders `{{...}}` y `{{brand.*}}` intactos (igual que el seed actual con `{{brand.colors.primary}}`). La interpolación la hace el `TemplateEngine` en `EmailRenderer`.
- Best-effort: `render()` nunca lanza (Fase 1). No romper esa garantía.
- Tests: Jest unit puros — instanciar con `new Clase(...)`, sin `Test.createTestingModule`. Correr `npm test -- <patrón>`.
- El `compiledBody` legacy (MJML) debe seguir funcionando: `EmailRenderer` usa `designJson.blocks` si existen, si no cae a `compiledBody`.
- Paridad: los 12 correos re-sembrados como bloques deben producir MJML equivalente (mismo contenido y variables) al seed MJML actual (`src/documents/seeds/email-templates.seed.ts`).

---

## Task 1: `EmailDoc` + `BlockComposer`

**Files:**
- Create: `src/documents/blocks/email-doc.types.ts`
- Create: `src/documents/blocks/block-composer.ts`
- Create: `src/documents/blocks/block-composer.spec.ts`

**Interfaces:**
- Produces:
  - Tipos `EmailBlock` (unión) y `EmailDoc { blocks: EmailBlock[] }`.
  - `BlockComposer.compose(doc: EmailDoc): string` — MJML completo (frame branded + bloques), con placeholders intactos.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/blocks/block-composer.spec.ts
import { BlockComposer } from './block-composer';
import { EmailDoc } from './email-doc.types';

const composer = new BlockComposer();

describe('BlockComposer.compose', () => {
  it('envuelve en frame MJML branded', () => {
    const mjml = composer.compose({ blocks: [] });
    expect(mjml.startsWith('<mjml')).toBe(true);
    expect(mjml).toContain('{{brand.fiscal.razonSocial}}');       // header del frame
    expect(mjml).toContain('{{brand.contact.website}}');          // footer del frame
  });

  it('heading y paragraph conservan placeholders', () => {
    const doc: EmailDoc = { blocks: [
      { id: '1', type: 'heading', text: '🚚 {{subsidiaryName}}' },
      { id: '2', type: 'paragraph', text: 'Unidad <b>{{vehicleName}}</b>' },
    ] };
    const mjml = composer.compose(doc);
    expect(mjml).toContain('{{subsidiaryName}}');
    expect(mjml).toContain('Unidad <b>{{vehicleName}}</b>');
    expect(mjml).toContain('color="{{brand.colors.primary}}"'); // heading usa color de marca
  });

  it('button usa color de marca y su url', () => {
    const mjml = composer.compose({ blocks: [{ id: 'b', type: 'button', text: 'Abrir', url: '{{resetLink}}' }] });
    expect(mjml).toContain('href="{{resetLink}}"');
    expect(mjml).toContain('background-color="{{brand.colors.button}}"');
    expect(mjml).toContain('Abrir');
  });

  it('table emite cabecera + each sobre rowsVar', () => {
    const mjml = composer.compose({ blocks: [{ id: 't', type: 'table', rowsVar: 'rows',
      columns: [{ label: 'Tracking', key: 'trackingNumber' }, { label: 'Nombre', key: 'recipientName' }] }] });
    expect(mjml).toContain('{{#each rows}}');
    expect(mjml).toContain('{{this.trackingNumber}}');
    expect(mjml).toContain('Tracking');
    expect(mjml).toContain('{{/each}}');
  });

  it('raw envuelve html sin escapar en mj-raw', () => {
    const mjml = composer.compose({ blocks: [{ id: 'r', type: 'raw', html: '{{{tableHtml}}}' }] });
    expect(mjml).toContain('<mj-raw>{{{tableHtml}}}</mj-raw>');
  });

  it('when envuelve el bloque en {{#if}}', () => {
    const mjml = composer.compose({ blocks: [{ id: 'b', type: 'button', text: 'X', url: '{{link}}', when: 'link' }] });
    expect(mjml).toContain('{{#if link}}');
    expect(mjml).toContain('{{/if}}');
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- block-composer`
Expected: FAIL (módulos no existen).

- [ ] **Step 3: Implementar los tipos**

```ts
// src/documents/blocks/email-doc.types.ts

/** Condición opcional: envuelve el bloque en {{#if <when>}} … {{/if}}. */
interface BlockBase { id: string; when?: string; }

export type EmailBlock =
  | (BlockBase & { type: 'heading'; text: string })
  | (BlockBase & { type: 'paragraph'; text: string })          // text puede incluir HTML simple (<b>, <br/>)
  | (BlockBase & { type: 'button'; text: string; url: string })
  | (BlockBase & { type: 'image'; src: string; alt?: string; width?: number })
  | (BlockBase & { type: 'divider' })
  | (BlockBase & { type: 'spacer'; size: number })
  | (BlockBase & { type: 'keyValue'; items: { label: string; value: string }[] }) // value = snippet Handlebars
  | (BlockBase & { type: 'table'; columns: { label: string; key: string }[]; rowsVar: string })
  | (BlockBase & { type: 'raw'; html: string });                // html = snippet Handlebars (va en mj-raw)

export interface EmailDoc { blocks: EmailBlock[]; }
```

- [ ] **Step 4: Implementar el composer**

```ts
// src/documents/blocks/block-composer.ts
import { Injectable } from '@nestjs/common';
import { EmailBlock, EmailDoc } from './email-doc.types';

/**
 * Convierte un EmailDoc (bloques) en MJML. NO interpola: deja intactos los
 * placeholders {{var}} y {{brand.*}} (los resuelve el TemplateEngine después).
 * El frame branded es idéntico al del seed de Fase 1 (header razón social + footer).
 */
@Injectable()
export class BlockComposer {
  compose(doc: EmailDoc): string {
    const inner = (doc?.blocks ?? []).map((b) => this.renderBlock(b)).join('\n');
    return `<mjml><mj-body background-color="#f4f4f4">
  <mj-section background-color="#ffffff"><mj-column>
    <mj-text font-size="18px" font-weight="bold" color="{{brand.colors.secondary}}">{{brand.fiscal.razonSocial}}</mj-text>
${inner}
    <mj-divider border-color="#eeeeee" />
    <mj-text font-size="12px" color="#7f8c8d">Este correo fue enviado automáticamente por el sistema. Por favor, no responda a este mensaje.<br/>{{brand.contact.website}}</mj-text>
  </mj-column></mj-section>
</mj-body></mjml>`;
  }

  private renderBlock(b: EmailBlock): string {
    const mjml = this.blockToMjml(b);
    return b.when ? `{{#if ${b.when}}}${mjml}{{/if}}` : mjml;
  }

  private blockToMjml(b: EmailBlock): string {
    switch (b.type) {
      case 'heading':
        return `<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">${b.text}</mj-text>`;
      case 'paragraph':
        return `<mj-text>${b.text}</mj-text>`;
      case 'button':
        return `<mj-button href="${b.url}" background-color="{{brand.colors.button}}">${b.text}</mj-button>`;
      case 'image':
        return `<mj-image src="${b.src}"${b.alt ? ` alt="${b.alt}"` : ''}${b.width ? ` width="${b.width}px"` : ''} />`;
      case 'divider':
        return `<mj-divider border-color="#eeeeee" />`;
      case 'spacer':
        return `<mj-spacer height="${b.size}px" />`;
      case 'keyValue':
        return `<mj-text>${b.items.map((i) => `<b>${i.label}:</b> ${i.value}`).join('<br/>')}</mj-text>`;
      case 'table': {
        const head = b.columns.map((c) => `<th style="text-align:left;border-bottom:1px solid #ddd;padding:6px">${c.label}</th>`).join('');
        const cells = b.columns.map((c) => `<td style="padding:6px">{{this.${c.key}}}</td>`).join('');
        return `<mj-table><tr>${head}</tr>{{#each ${b.rowsVar}}}<tr>${cells}</tr>{{/each}}</mj-table>`;
      }
      case 'raw':
        return `<mj-raw>${b.html}</mj-raw>`;
    }
  }
}
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -- block-composer`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/documents/blocks/email-doc.types.ts src/documents/blocks/block-composer.ts src/documents/blocks/block-composer.spec.ts
git commit -m "feat(documents): EmailDoc (bloques) + BlockComposer (bloques->MJML)"
```

---

## Task 2: `EmailRenderer` compone desde bloques (con fallback legacy)

**Files:**
- Modify: `src/documents/renderers/email.renderer.ts`
- Modify: `src/documents/renderers/email.renderer.spec.ts`

**Interfaces:**
- Consumes: `BlockComposer.compose(doc)` (Task 1), `TemplateEngine.render`, `mjml2html`.
- Produces: `EmailRenderer` que usa `version.designJson` (EmailDoc) si tiene `blocks`, si no `version.compiledBody` (MJML legacy).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/documents/renderers/email.renderer.spec.ts` (el spec ya instancia `new EmailRenderer(new TemplateEngine())` — actualizar a `new EmailRenderer(new TemplateEngine(), new BlockComposer())` en todos los `new`):

```ts
import { BlockComposer } from '../blocks/block-composer';
// ...
function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://x', env: 'test' } };
}
const r = new EmailRenderer(new TemplateEngine(), new BlockComposer());

it('compone desde designJson (bloques) cuando existen', async () => {
  const v: any = { subject: 'Hola {{cliente}}', designJson: { blocks: [
    { id: '1', type: 'paragraph', text: 'Hola {{cliente}}' },
  ] } };
  const out = await r.render(v, ctx({ cliente: 'Ana' }));
  expect(out.subject).toBe('Hola Ana');
  expect(out.html).toContain('Hola Ana');       // compuesto + MJML compilado
  expect(out.html).toContain('<!doctype html>'); // salida MJML
});

it('cae a compiledBody (MJML legacy) si no hay bloques', async () => {
  const v: any = { subject: 'X', compiledBody: '<mjml><mj-body><mj-section><mj-column><mj-text>Legacy {{cliente}}</mj-text></mj-column></mj-section></mj-body></mjml>' };
  const out = await r.render(v, ctx({ cliente: 'Bob' }));
  expect(out.html).toContain('Legacy Bob');
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- email.renderer`
Expected: FAIL (arity del constructor / designJson no usado).

- [ ] **Step 3: Refactorizar el renderer**

```ts
// src/documents/renderers/email.renderer.ts
import { Injectable } from '@nestjs/common';
import mjml2html = require('mjml');
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateEngine } from '../template-engine';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';
import { BlockComposer } from '../blocks/block-composer';

@Injectable()
export class EmailRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'email';

  constructor(
    private readonly engine: TemplateEngine,
    private readonly composer: BlockComposer,
  ) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    const subject = this.engine.render(version.subject ?? '', ctx);
    // Preferir bloques (designJson.blocks); fallback a compiledBody MJML legacy.
    const doc: any = version.designJson;
    const source = doc && Array.isArray(doc.blocks) ? this.composer.compose(doc) : (version.compiledBody ?? '');
    const rendered = this.engine.render(source, ctx);
    const html = rendered.includes('<mjml')
      ? (await (mjml2html as any)(rendered, { validationLevel: 'soft' })).html
      : rendered;
    return { format: 'email', mime: 'text/html', subject, html };
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- email.renderer`
Expected: PASS (los existentes + 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/documents/renderers/email.renderer.ts src/documents/renderers/email.renderer.spec.ts
git commit -m "feat(documents): EmailRenderer compone desde bloques (fallback a MJML legacy)"
```

---

## Task 3: Re-seed de los 12 correos como bloques

**Files:**
- Modify: `src/documents/seeds/email-templates.seed.ts`
- Modify: `src/documents/seeds/email-templates.seed.spec.ts`

**Interfaces:**
- Consumes: `BlockComposer.compose(doc)`.
- Produces: `EMAIL_TEMPLATE_SEEDS` con `blocks: EmailBlock[]` por correo; `seedEmailTemplates` guarda `designJson = { blocks }` y `compiledBody = composer.compose({ blocks })`.

- [ ] **Step 1: Cambiar el tipo de seed y las 12 entradas a bloques**

Reemplazar en `email-templates.seed.ts`: quitar el helper `wrap` y el campo `body: string`; cambiar `EmailSeed` a usar `blocks`. Importar los tipos:

```ts
import { EmailBlock } from '../blocks/email-doc.types';
import { BlockComposer } from '../blocks/block-composer';

export interface EmailSeedVar { name: string; label: string; dataType?: string; example?: string; required?: boolean; }
export interface EmailSeed { code: string; name: string; subject: string; blocks: EmailBlock[]; variables: EmailSeedVar[]; }
```

Definir las 12 entradas (subject y variables se conservan del seed actual; el `body` MJML se traduce a `blocks` equivalentes):

```ts
export const EMAIL_TEMPLATE_SEEDS: EmailSeed[] = [
  { code: 'route_dispatch', name: 'Salida a Ruta',
    subject: 'Salida a ruta - {{driverName}} - {{formatDate createdAt}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Salida a Ruta' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Salida a Ruta</b> para la sucursal <b>{{subsidiaryName}}</b> en la unidad <b>{{vehicleName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha y hora', value: '{{formatDate createdAt}}' },
        { label: 'Responsable(s)', value: '{{drivers}}' },
        { label: 'Ruta(s)', value: '{{routes}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'drivers', label: 'Responsables' },
      { name: 'routes', label: 'Rutas' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'driverName', label: 'Chofer principal' },
    ] },

  { code: 'unloading', name: 'Desembarque',
    subject: '🚚 Desembarque {{formatDate createdAt}} de {{subsidiaryName}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Desembarque' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Desembarque</b> para la sucursal <b>{{subsidiaryName}}</b> descargado de la unidad <b>{{vehicleName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha y hora', value: '{{formatDate createdAt}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
    ] },

  { code: 'route_closure', name: 'Cierre de Ruta',
    subject: '🚚 CIERRE DE RUTA - {{driverName}} - {{formatDate createdAt}} DE {{subsidiaryName}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Cierre de Ruta' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Cierre de Ruta</b> para la sucursal <b>{{subsidiaryName}}</b>.' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'driverName', label: 'Chofer' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
    ] },

  { code: 'inventory_report', name: 'Inventario',
    subject: '📦 Inventario {{formatDate inventoryDate}} de {{subsidiaryName}}',
    blocks: [
      { id: 'h', type: 'heading', text: '📦 Reporte de Inventario' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Inventario</b> para la sucursal <b>{{subsidiaryName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha', value: '{{formatDate inventoryDate}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'inventoryDate', label: 'Fecha de inventario', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
    ] },

  { code: 'devolutions', name: 'Devoluciones/Recolecciones',
    subject: '🚚 Devoluciones/Recolecciones {{formatDate createdAt}} de {{subsidiaryName}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Devoluciones/Recolecciones' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Devoluciones/Recolecciones</b> para la sucursal <b>{{subsidiaryName}}</b>.' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
    ] },

  { code: 'dex03_report', name: 'Paquetes con status DEX03',
    subject: '🚨🚥 Paquetes con status DEX03 de {{subsidiaryName}}',
    blocks: [
      { id: 'h', type: 'heading', text: 'Reporte de Paquetes con DEX03 — {{subsidiaryName}}' },
      { id: 'p', type: 'paragraph', text: 'Se detectaron los siguientes envíos con status DEX03. Considere la fecha de recepción ({{formatDate today}}) para su seguimiento.' },
      { id: 't', type: 'table', rowsVar: 'rows', columns: [
        { label: 'Tracking', key: 'trackingNumber' },
        { label: 'Nombre', key: 'recipientName' },
        { label: 'Dirección', key: 'recipientAddress' },
        { label: 'CP', key: 'recipientZip' },
        { label: 'Fecha', key: 'timestamp' },
        { label: 'Por', key: 'doItByUser' },
        { label: 'Teléfono', key: 'recipientPhone' },
      ] },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'today', label: 'Fecha del reporte', dataType: 'date' },
      { name: 'rows', label: 'Filas (envíos DEX03)' },
    ] },

  { code: 'high_priority_shipments', name: 'Envíos Prioridad Alta en Curso',
    subject: '🔴 Envíos con Prioridad Alta en Curso',
    blocks: [
      { id: 'h', type: 'heading', text: 'Envíos con Prioridad Alta en Curso' },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ],
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }] },

  { code: 'unloading_priority_packages', name: 'Envíos Prioridad Alta en Descarga',
    subject: '🔴 Envíos con Prioridad Alta en Descarga',
    blocks: [
      { id: 'h', type: 'heading', text: 'Envíos con Prioridad Alta en Descarga' },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ],
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }] },

  { code: 'inventory_priority_packages', name: 'Envíos Prioridad Alta en Inventario',
    subject: '🔴 Envíos con Prioridad Alta en Inventario',
    blocks: [
      { id: 'h', type: 'heading', text: 'Envíos con Prioridad Alta en Inventario' },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ],
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }] },

  { code: 'password_reset_otp', name: 'Código de recuperación (OTP)',
    subject: 'Tu código de recuperación: {{code}}',
    blocks: [
      { id: 'h', type: 'heading', text: 'Recuperación de contraseña — PMY App' },
      { id: 'p', type: 'paragraph', text: 'Usa este código para restablecer tu contraseña. Vence en {{minutes}} minutos.' },
      { id: 'code', type: 'paragraph', text: '<div style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center">{{code}}</div>' },
      { id: 'note', type: 'paragraph', text: 'Si no solicitaste este código, ignora este correo.' },
    ],
    variables: [
      { name: 'code', label: 'Código OTP', required: true },
      { name: 'minutes', label: 'Minutos de vigencia', dataType: 'number' },
    ] },

  { code: 'password_reset_link', name: 'Restablecer contraseña (enlace)',
    subject: 'Password Reset Request',
    blocks: [
      { id: 'p', type: 'paragraph', text: 'Para restablecer tu contraseña, haz clic en el siguiente enlace:' },
      { id: 'b', type: 'button', text: 'Restablecer contraseña', url: '{{resetLink}}' },
    ],
    variables: [{ name: 'resetLink', label: 'Enlace de restablecimiento', required: true }] },

  { code: 'generic_notification', name: 'Notificación genérica',
    subject: '{{title}}',
    blocks: [
      { id: 'h', type: 'heading', text: '{{title}}' },
      { id: 'p', type: 'paragraph', text: '{{body}}' },
      { id: 'b', type: 'button', text: 'Abrir en PMY', url: '{{link}}', when: 'link' },
    ],
    variables: [
      { name: 'title', label: 'Título' },
      { name: 'body', label: 'Cuerpo' },
      { name: 'link', label: 'Enlace' },
    ] },
];
```

- [ ] **Step 2: Actualizar `seedEmailTemplates` para guardar bloques + MJML compuesto**

En la función `seedEmailTemplates`, instanciar el composer y guardar ambos campos en la versión:

```ts
// al inicio de seedEmailTemplates:
const composer = new BlockComposer();
// ...donde hoy crea la versión con `subject: seed.subject, compiledBody: seed.body`:
version = await repos.verRepo.save(repos.verRepo.create({
  templateId: template.id, version: 1, status: 'published',
  subject: seed.subject,
  designJson: { blocks: seed.blocks },
  compiledBody: composer.compose({ blocks: seed.blocks }),
  engine: 'handlebars',
  changelog: 'Seed inicial (bloques, paridad con legacy)', publishedAt: new Date(),
}));
```

(El resto de `seedEmailTemplates` — upsert idempotente por `code`, variable defs, `currentVersionId` — se conserva igual.)

- [ ] **Step 3: Actualizar el spec del seed**

En `email-templates.seed.spec.ts`, el test que hoy verifica `EMAIL_TEMPLATE_SEEDS` — cambiar cualquier aserción sobre `.body` por `.blocks`. Añadir:

```ts
it('cada correo tiene bloques y la versión sembrada guarda designJson', async () => {
  const r = repos();  // helper existente
  await seedEmailTemplates(r as any);
  expect(EMAIL_TEMPLATE_SEEDS.every((s) => Array.isArray(s.blocks) && s.blocks.length > 0)).toBe(true);
  const v = r._state.versions.find((x: any) => x.designJson);
  expect(v.designJson.blocks.length).toBeGreaterThan(0);
  expect(String(v.compiledBody)).toContain('<mjml'); // MJML compuesto guardado
});

it('route_dispatch conserva sus variables', () => {
  const seed = EMAIL_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch')!;
  expect(seed.variables.map((v) => v.name)).toEqual(
    expect.arrayContaining(['subsidiaryName', 'vehicleName', 'createdAt', 'drivers', 'routes', 'trackingNumber']),
  );
});
```

(Conservar los tests de idempotencia y de "12 plantillas" existentes; solo ajustar los que referencian `body`.)

- [ ] **Step 4: Correr los tests**

Run: `npm test -- email-templates.seed`
Expected: PASS (idempotencia + los 2 nuevos + los ajustados).

- [ ] **Step 5: Commit**

```bash
git add src/documents/seeds/email-templates.seed.ts src/documents/seeds/email-templates.seed.spec.ts
git commit -m "feat(documents): re-seed de los 12 correos como bloques (designJson) + MJML compuesto"
```

---

## Task 4: Wiring del módulo + verificación

**Files:**
- Modify: `src/documents/documents.module.ts`

**Interfaces:**
- Consumes: `BlockComposer` (Task 1), `EmailRenderer` (Task 2).
- Produces: `BlockComposer` registrado como provider e inyectado en `EmailRenderer`.

- [ ] **Step 1: Registrar el provider**

En `src/documents/documents.module.ts`: importar `BlockComposer` (`from './blocks/block-composer'`) y añadirlo al array `providers` (antes de `EmailRenderer`, para que resuelva la inyección). `EmailRenderer` ya está en `providers`; su nueva dependencia `BlockComposer` se resuelve del contenedor.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compila; DI resuelve (`EmailRenderer(TemplateEngine, BlockComposer)`).

- [ ] **Step 3: Correr toda la suite del módulo documents**

Run: `npx jest src/documents`
Expected: verde (block-composer, email.renderer, email-templates.seed, y los demás de Fase 1 sin regresión).

- [ ] **Step 4: Verificar arranque de la app**

Run: `node dist/main.js` (tras `npm run build`); esperar `Nest application successfully started`; detener.
Expected: sin errores de DI.

- [ ] **Step 5: Commit + refrescar grafo**

```bash
git add src/documents/documents.module.ts
git commit -m "feat(documents): registra BlockComposer en DocumentsModule"
graphify update .
```

---

## Self-Review (autor)

- **Cobertura del spec (Etapa 1):** `EmailDoc`/bloques §3.1 → T1; `BlockComposer` §4 → T1; `EmailRenderer` compone desde bloques §4 → T2; re-seed 12 correos como bloques §5 → T3; wiring/DI → T4. (PDF/Excel/editor son Etapas 2-4, fuera de este plan.)
- **Consistencia de tipos:** `EmailDoc { blocks: EmailBlock[] }`, `BlockComposer.compose(doc): string`, `EmailRenderer(TemplateEngine, BlockComposer)` — idénticos entre T1/T2/T3/T4.
- **Fallback legacy:** T2 preserva `compiledBody` MJML para filas de Fase 1 que no tengan `designJson.blocks` — no rompe datos existentes.
- **Paridad:** cada uno de los 12 correos se traduce a bloques que producen el mismo contenido/variables que el MJML actual; el frame branded del composer es idéntico al `wrap()` de Fase 1.
- **Riesgo:** el `mj-table` compuesto para `dex03_report` usa estilos inline simples (no idénticos pixel a pixel al HTML manual anterior, pero equivalentes y con las mismas columnas/variables) — aceptable para paridad de contenido.
