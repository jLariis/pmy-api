# Motor de Plantillas — Fase 3 Etapa 3a: Motor PDF + PDF de Bodega Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el `PdfRenderer` (HTML→PDF con Chromium headless) sobre un modelo `PdfDoc`, y recrear fielmente el único PDF de backend (`warehouse_dispatch_pdf`) como plantilla — conservando el generador `pdfmake` actual como **fallback** si Chromium no está disponible.

**Architecture:** Un `PdfHtmlComposer` puro convierte un `PdfDoc` (layout de reporte) en HTML branded con placeholders `{{var}}`/`{{brand.*}}` intactos. `PdfRenderer` compone → interpola (TemplateEngine) → convierte a PDF vía un `HtmlToPdfService` inyectable (playwright-core Chromium), que se mockea en tests. `warehouse.service` renderiza el PDF por el motor y cae al generador `pdfmake` legacy si el motor no produce buffer.

**Tech Stack:** NestJS, `playwright-core` (nuevo), Handlebars (Fase 1), Jest. Datos/lógica del reporte en código; presentación en la plantilla.

## Global Constraints

- Repo `D:\PMY\pmy-api`, branch **`feat/template-engine-phase3`**. NO mergear a main.
- Hook **graphify**: `graphify query "<pregunta>"` antes de leer/editar cualquier fuente.
- **`render()` nunca lanza** (Fase 1). Para PDF: si la conversión Chromium falla, `PdfRenderer` NO debe romper — devuelve `RenderResult` sin `buffer` (el llamador cae a legacy). El `HtmlToPdfService` aísla playwright y es lo ÚNICO no unit-testeable (se mockea).
- **Chromium:** `playwright-core` NO descarga navegador. `HtmlToPdfService` lanza Chromium por `executablePath` desde `process.env.CHROMIUM_PATH` o `channel:'chrome'`; si no hay binario, `convert()` lanza → capturado → sin buffer → fallback legacy. Documentar que producción debe instalar Chromium/Chrome. **No** correr Chromium en tests (mockear).
- Presentación (columnas/colores/anchos/variantes) en la plantilla `PdfDoc`; **datos y lógica** (filas, flags de color, variante Hermosillo) en código, pasados a `render(code, data)`. Paridad visual con `warehouse_dispatch_pdf` del inventario (docs/superpowers/references/document-inventory.md §B1).
- NO tocar el Excel de bodega (`generateExcelBuffer`) — es Etapa 4. Conservar `pdfmake`/`generatePdfBuffer` legacy como fallback (no borrar).
- Tests: Jest unit con mocks. `RenderResult` (Fase 1) ya tiene `buffer?: Buffer` y `mime`/`filename`.

---

## Task 1: `PdfDoc` types + `PdfHtmlComposer`

**Files:**
- Modify: `package.json` (dep `playwright-core`)
- Create: `src/documents/blocks/pdf-doc.types.ts`
- Create: `src/documents/blocks/pdf-html-composer.ts`
- Create: `src/documents/blocks/pdf-html-composer.spec.ts`

**Interfaces:**
- Produces: tipos `PdfBlock`/`PdfDoc`; `PdfHtmlComposer.compose(doc: PdfDoc): string` (HTML branded con placeholders intactos).

- [ ] **Step 1: Instalar playwright-core**

Run: `npm install playwright-core`
Expected: se agrega a `dependencies`.

- [ ] **Step 2: Escribir el test que falla**

```ts
// src/documents/blocks/pdf-html-composer.spec.ts
import { PdfHtmlComposer } from './pdf-html-composer';
import { PdfDoc } from './pdf-doc.types';

const composer = new PdfHtmlComposer();

describe('PdfHtmlComposer.compose', () => {
  it('emite documento HTML con orientación y placeholders de marca', () => {
    const doc: PdfDoc = { page: { size: 'LETTER', orientation: 'landscape' }, blocks: [] };
    const html = composer.compose(doc);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('@page { size: LETTER landscape');
    expect(html).toContain('{{brand.colors.primary}}'); // usa marca en estilos
  });

  it('header con título y fecha/hora', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, header: { title: '{{title}}', showDateTime: true }, blocks: [] });
    expect(html).toContain('{{title}}');
    expect(html).toContain('{{system.now}}'); // marcador de fecha/hora
  });

  it('infoGrid emite celdas etiqueta/valor con placeholders', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, blocks: [
      { type: 'infoGrid', cells: [{ label: 'SUCURSAL', value: '{{subsidiaryName}}' }] },
    ] });
    expect(html).toContain('SUCURSAL');
    expect(html).toContain('{{subsidiaryName}}');
  });

  it('table emite cabecera + each, oculta columna con hideWhen, aplica clase por fila', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, blocks: [
      { type: 'table', rowsVar: 'rows', rowClassVar: 'rowClass', columns: [
        { label: 'NO. GUIA', key: 'trackingNumber' },
        { label: 'HORA', key: 'time', hideWhen: 'isHermosillo' },
      ] },
    ] });
    expect(html).toContain('{{#each rows}}');
    expect(html).toContain('{{this.trackingNumber}}');
    expect(html).toContain('class="{{this.rowClass}}"');
    expect(html).toContain('{{#unless isHermosillo}}'); // columna condicional
  });

  it('symbology y footer', () => {
    const html = composer.compose({ page: { size: 'LETTER', orientation: 'landscape' }, blocks: [
      { type: 'symbology', text: '[C] CARGA' }, { type: 'footer', text: 'pie {{system.env}}' },
    ] });
    expect(html).toContain('[C] CARGA');
    expect(html).toContain('pie {{system.env}}');
  });
});
```

- [ ] **Step 3: Correr para confirmar el fallo**

Run: `npm test -- pdf-html-composer`
Expected: FAIL (módulos no existen).

- [ ] **Step 4: Implementar los tipos**

```ts
// src/documents/blocks/pdf-doc.types.ts
export interface PdfPage { size: 'LETTER' | 'A4'; orientation: 'landscape' | 'portrait'; margins?: string; }

export interface PdfColumn { label: string; key: string; width?: number; align?: 'left' | 'center' | 'right'; hideWhen?: string; }

export type PdfBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'symbology'; text: string }
  | { type: 'infoGrid'; cells: { label: string; value: string }[] }
  | { type: 'statBoxes'; boxes: { label: string; value: string }[] }
  | { type: 'table'; rowsVar: string; columns: PdfColumn[]; rowClassVar?: string }
  | { type: 'signatures'; slots: { label: string }[] }
  | { type: 'footer'; text: string };

export interface PdfDoc {
  page: PdfPage;
  header?: { title: string; showDateTime?: boolean };
  blocks: PdfBlock[];
}
```

- [ ] **Step 5: Implementar el composer**

```ts
// src/documents/blocks/pdf-html-composer.ts
import { Injectable } from '@nestjs/common';
import { PdfBlock, PdfDoc } from './pdf-doc.types';

/**
 * Convierte un PdfDoc en HTML branded. NO interpola: deja {{var}}/{{brand.*}}
 * intactos (los resuelve el TemplateEngine antes de Chromium). Estilos usan
 * tokens de marca vía placeholders.
 */
@Injectable()
export class PdfHtmlComposer {
  compose(doc: PdfDoc): string {
    const margins = doc.page.margins ?? '20px';
    const header = doc.header
      ? `<div class="doc-header"><div class="doc-title">${doc.header.title}</div>${doc.header.showDateTime ? `<div class="doc-datetime">{{system.now}}</div>` : ''}</div>`
      : '';
    const body = (doc.blocks ?? []).map((b) => this.block(b)).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${doc.page.size} ${doc.page.orientation}; margin: ${margins}; }
      * { box-sizing: border-box; font-family: {{brand.typography.fontFamily}}; }
      body { color: {{brand.colors.text}}; font-size: 11px; margin: 0; }
      .doc-header { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid {{brand.colors.primary}}; padding-bottom:6px; margin-bottom:8px; }
      .doc-title { font-size:18px; font-weight:bold; color:{{brand.colors.secondary}}; }
      .doc-datetime { font-size:11px; color:#555; text-align:right; white-space:pre-line; }
      .info-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:8px 0; }
      .info-cell { background:#f8f9fa; padding:6px; border-radius:4px; }
      .info-cell .k { font-size:9px; color:#777; } .info-cell .v { font-weight:bold; }
      .symbology { font-size:10px; color:#555; margin:6px 0; }
      table { width:100%; border-collapse:collapse; margin-top:6px; }
      th { background:{{brand.colors.primary}}; color:#fff; padding:5px; font-size:10px; text-align:left; }
      td { padding:4px 5px; border-bottom:0.5px solid #ccc; font-size:10px; }
      tr.pago td { background:#fff2cc; } tr.vencehoy td { background:#ffe6e6; }
      .stat-boxes { display:flex; gap:8px; margin:8px 0; } .stat-box { flex:1; background:#f8f9fa; border-radius:6px; padding:8px; text-align:center; }
      .signatures { display:flex; gap:24px; margin-top:28px; } .sig { flex:1; border-top:1px solid #333; padding-top:4px; font-size:10px; text-align:center; }
      .doc-footer { margin-top:16px; font-size:9px; color:#7f8c8d; }
    </style></head><body>
${header}
${body}
</body></html>`;
  }

  private block(b: PdfBlock): string {
    switch (b.type) {
      case 'heading': return `<h2 style="color:{{brand.colors.primary}}">${b.text}</h2>`;
      case 'paragraph': return `<p>${b.text}</p>`;
      case 'symbology': return `<div class="symbology">${b.text}</div>`;
      case 'infoGrid':
        return `<div class="info-grid">${b.cells.map((c) => `<div class="info-cell"><div class="k">${c.label}</div><div class="v">${c.value}</div></div>`).join('')}</div>`;
      case 'statBoxes':
        return `<div class="stat-boxes">${b.boxes.map((x) => `<div class="stat-box"><div class="v" style="font-size:18px;font-weight:bold">${x.value}</div><div class="k" style="font-size:9px;color:#777">${x.label}</div></div>`).join('')}</div>`;
      case 'table': {
        const th = b.columns.map((c) => this.wrapCol(c, `<th${c.width ? ` style="width:${c.width}px"` : ''}${c.align ? ` style="text-align:${c.align}"` : ''}>${c.label}</th>`)).join('');
        const td = b.columns.map((c) => this.wrapCol(c, `<td${c.align ? ` style="text-align:${c.align}"` : ''}>{{this.${c.key}}}</td>`)).join('');
        const cls = b.rowClassVar ? ` class="{{this.${b.rowClassVar}}}"` : '';
        return `<table><thead><tr>${th}</tr></thead><tbody>{{#each ${b.rowsVar}}}<tr${cls}>${td}</tr>{{/each}}</tbody></table>`;
      }
      case 'signatures':
        return `<div class="signatures">${b.slots.map((s) => `<div class="sig">${s.label}</div>`).join('')}</div>`;
      case 'footer': return `<div class="doc-footer">${b.text}</div>`;
      default: return '';
    }
  }

  /** Columna condicional: {{#unless <hideWhen>}} … {{/unless}}. */
  private wrapCol(c: { hideWhen?: string }, html: string): string {
    return c.hideWhen ? `{{#unless ${c.hideWhen}}}${html}{{/unless}}` : html;
  }
}
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -- pdf-html-composer`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/documents/blocks/pdf-doc.types.ts src/documents/blocks/pdf-html-composer.ts src/documents/blocks/pdf-html-composer.spec.ts
git commit -m "feat(documents): PdfDoc + PdfHtmlComposer (layout de reporte -> HTML branded)"
```

---

## Task 2: `HtmlToPdfService` + `PdfRenderer` + registro

**Files:**
- Create: `src/documents/html-to-pdf.service.ts`
- Create: `src/documents/renderers/pdf.renderer.ts`
- Create: `src/documents/renderers/pdf.renderer.spec.ts`
- Modify: `src/documents/documents.module.ts`

**Interfaces:**
- Consumes: `PdfHtmlComposer.compose` (Task 1), `TemplateEngine.render`, `RenderContext`/`RenderResult`, `DocumentRenderer`.
- Produces:
  - `HtmlToPdfService.convert(html: string): Promise<Buffer>` (playwright-core Chromium; lanza si no hay navegador).
  - `PdfRenderer` (`format='pdf'`): compone `version.designJson` (PdfDoc) → HTML → engine.render → `htmlToPdf.convert` → `RenderResult{ format:'pdf', mime:'application/pdf', buffer }`. Si `convert` falla, loguea y devuelve `RenderResult` SIN `buffer` (nunca lanza).

- [ ] **Step 1: Implementar `HtmlToPdfService`** (sin test unitario — envuelve playwright; se mockea en el test de PdfRenderer)

```ts
// src/documents/html-to-pdf.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';

/** Aísla la conversión HTML→PDF con Chromium headless (playwright-core). */
@Injectable()
export class HtmlToPdfService {
  private readonly logger = new Logger(HtmlToPdfService.name);

  async convert(html: string): Promise<Buffer> {
    const launchOpts: any = process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'chrome' };
    const browser = await chromium.launch(launchOpts);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await browser.close().catch((e) => this.logger.warn(`cierre de Chromium: ${e?.message}`));
    }
  }
}
```

- [ ] **Step 2: Escribir el test que falla (PdfRenderer con playwright mockeado)**

```ts
// src/documents/renderers/pdf.renderer.spec.ts
import { PdfRenderer } from './pdf.renderer';
import { TemplateEngine } from '../template-engine';
import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://x', env: 'test' } };
}

describe('PdfRenderer', () => {
  it('compone PdfDoc, interpola y produce buffer PDF', async () => {
    const htmlToPdf: any = { convert: jest.fn((html: string) => Promise.resolve(Buffer.from('PDF:' + html))) };
    const r = new PdfRenderer(new TemplateEngine(), new PdfHtmlComposer(), htmlToPdf);
    const v: any = { designJson: { page: { size: 'LETTER', orientation: 'landscape' }, header: { title: '{{title}}' }, blocks: [
      { type: 'infoGrid', cells: [{ label: 'SUCURSAL', value: '{{subsidiaryName}}' }] },
    ] } };
    const out = await r.render(v, ctx({ title: 'SALIDA', subsidiaryName: 'Obregón' }));
    expect(out.format).toBe('pdf');
    expect(out.mime).toBe('application/pdf');
    expect(out.buffer).toBeInstanceOf(Buffer);
    const sent = htmlToPdf.convert.mock.calls[0][0];
    expect(sent).toContain('SALIDA');       // {{title}} interpolado antes de Chromium
    expect(sent).toContain('Obregón');
    expect(sent).not.toContain('{{');       // sin placeholders residuales
  });

  it('nunca lanza: si la conversión falla, devuelve result sin buffer', async () => {
    const htmlToPdf: any = { convert: () => Promise.reject(new Error('no chromium')) };
    const r = new PdfRenderer(new TemplateEngine(), new PdfHtmlComposer(), htmlToPdf);
    const v: any = { designJson: { page: { size: 'LETTER', orientation: 'portrait' }, blocks: [] } };
    const out = await r.render(v, ctx({}));
    expect(out.format).toBe('pdf');
    expect(out.buffer).toBeUndefined();
  });
});
```

- [ ] **Step 3: Correr para confirmar el fallo**

Run: `npm test -- pdf.renderer`
Expected: FAIL (módulo no existe).

- [ ] **Step 4: Implementar `PdfRenderer`**

```ts
// src/documents/renderers/pdf.renderer.ts
import { Injectable, Logger } from '@nestjs/common';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateEngine } from '../template-engine';
import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { HtmlToPdfService } from '../html-to-pdf.service';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';

@Injectable()
export class PdfRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'pdf';
  private readonly logger = new Logger(PdfRenderer.name);

  constructor(
    private readonly engine: TemplateEngine,
    private readonly composer: PdfHtmlComposer,
    private readonly htmlToPdf: HtmlToPdfService,
  ) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    const doc: any = version.designJson;
    const template = doc && doc.blocks ? this.composer.compose(doc) : '';
    const html = this.engine.render(template, ctx);
    try {
      const buffer = await this.htmlToPdf.convert(html);
      return { format: 'pdf', mime: 'application/pdf', buffer, html };
    } catch (e: any) {
      this.logger.warn(`conversión PDF falló (sin Chromium?): ${e?.message}`);
      return { format: 'pdf', mime: 'application/pdf', html }; // sin buffer → el llamador cae a legacy
    }
  }
}
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -- pdf.renderer`
Expected: PASS (2 tests).

- [ ] **Step 6: Registrar en el módulo**

En `src/documents/documents.module.ts`: importar `PdfHtmlComposer`, `HtmlToPdfService`, `PdfRenderer`; añadirlos a `providers` (antes de la factory `DOCUMENT_RENDERERS`); y actualizar la factory para incluir el PdfRenderer:

```ts
{ provide: DOCUMENT_RENDERERS, useFactory: (email: EmailRenderer, pdf: PdfRenderer) => [email, pdf], inject: [EmailRenderer, PdfRenderer] },
```

- [ ] **Step 7: Build + correr suite documents**

Run: `npm run build && npx jest src/documents`
Expected: compila; suite verde (incluye pdf-html-composer + pdf.renderer + los previos).

- [ ] **Step 8: Commit**

```bash
git add src/documents/html-to-pdf.service.ts src/documents/renderers/pdf.renderer.ts src/documents/renderers/pdf.renderer.spec.ts src/documents/documents.module.ts
git commit -m "feat(documents): PdfRenderer (Chromium headless) + HtmlToPdfService, registrado"
```

---

## Task 3: Seed `warehouse_dispatch_pdf` (PdfDoc fiel)

**Files:**
- Create: `src/documents/seeds/pdf-templates.seed.ts`
- Create: `src/documents/seeds/pdf-templates.seed.spec.ts`
- Modify: `src/seed/seed-utils.ts` (invocar el seed de PDF)

**Interfaces:**
- Consumes: repos `DocumentTemplate`, `DocumentTemplateVersion`, `TemplateVariableDef`; tipos `PdfDoc`.
- Produces: `PDF_TEMPLATE_SEEDS` (array) + `seedPdfTemplates(repos)` (upsert idempotente por `code`, `type:'pdf'`, versión publicada v1 con `designJson = PdfDoc`).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/seeds/pdf-templates.seed.spec.ts
import { seedPdfTemplates, PDF_TEMPLATE_SEEDS } from './pdf-templates.seed';

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
    varRepo: { find: ({ where }: any) => Promise.resolve(vars.filter((x) => x.templateId === where.templateId)), create: (d: any) => d, save: (arr: any[]) => { vars.push(...arr); return Promise.resolve(arr); } },
    _state: { templates, versions, vars },
  };
}

describe('seedPdfTemplates', () => {
  it('siembra warehouse_dispatch_pdf como type pdf con PdfDoc', async () => {
    const r = repos();
    await seedPdfTemplates(r as any);
    const t = r._state.templates.find((x: any) => x.code === 'warehouse_dispatch_pdf');
    expect(t).toBeDefined();
    expect(t.type).toBe('pdf');
    const v = r._state.versions.find((x: any) => x.templateId === t.id);
    expect(v.designJson.page.orientation).toBe('landscape');
    expect(v.designJson.blocks.some((b: any) => b.type === 'table')).toBe(true);
  });

  it('es idempotente', async () => {
    const r = repos();
    await seedPdfTemplates(r as any); await seedPdfTemplates(r as any);
    expect(r._state.templates.filter((t: any) => t.code === 'warehouse_dispatch_pdf').length).toBe(1);
  });

  it('la tabla incluye la columna HORA condicionada a isHermosillo', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'warehouse_dispatch_pdf')!;
    const table = seed.doc.blocks.find((b: any) => b.type === 'table') as any;
    const hora = table.columns.find((c: any) => c.label === 'HORA');
    expect(hora.hideWhen).toBe('isHermosillo');
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- pdf-templates.seed`
Expected: FAIL.

- [ ] **Step 3: Implementar el seed (fiel al inventario §B1)**

```ts
// src/documents/seeds/pdf-templates.seed.ts
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { PdfDoc } from '../blocks/pdf-doc.types';

export interface PdfSeedVar { name: string; label: string; dataType?: string; }
export interface PdfSeed { code: string; name: string; doc: PdfDoc; variables: PdfSeedVar[]; }

/** warehouse_dispatch_pdf — fiel al PDF pdfmake actual (inventario §B1). Datos/flags en código. */
const warehouseDispatch: PdfDoc = {
  page: { size: 'LETTER', orientation: 'landscape', margins: '20px' },
  header: { title: '{{title}}', showDateTime: true },
  blocks: [
    { type: 'infoGrid', cells: [
      { label: 'SUCURSAL', value: '{{subsidiaryName}}' },
      { label: 'VEHÍCULO', value: '{{vehicleName}}' },
      { label: 'TOTAL PAQUETES', value: '{{totalPackages}}' },
      { label: 'SEGUIMIENTO', value: '{{trackingNumber}}' },
    ] },
    { type: 'symbology', text: 'SIMBOLOGÍA: [C] CARGA/F2/31.5 - [$] PAGO - [H] VALOR ALTO - [A] AÉREO' },
    { type: 'table', rowsVar: 'rows', rowClassVar: 'rowClass', columns: [
      { label: '[#]', key: 'index', width: 20 },
      { label: 'NO. GUIA', key: 'trackingNumber', width: 65 },
      { label: 'NOMBRE', key: 'recipientName', width: 100 },
      { label: 'DIRECCIÓN', key: 'recipientAddress', width: 140 },
      { label: 'CP', key: 'recipientZip', width: 30 },
      { label: 'COBRO', key: 'payment', width: 50 },
      { label: 'FECHA', key: 'date', width: 50 },
      { label: 'HORA', key: 'time', width: 40, hideWhen: 'isHermosillo' },
      { label: 'CELULAR', key: 'recipientPhone', width: 60 },
      { label: 'FIRMA', key: 'signature', width: 80 },
    ] },
  ],
};

export const PDF_TEMPLATE_SEEDS: PdfSeed[] = [
  { code: 'warehouse_dispatch_pdf', name: 'Salida a Ruta / Bodega (PDF)', doc: warehouseDispatch,
    variables: [
      { name: 'title', label: 'Título' },
      { name: 'subsidiaryName', label: 'Sucursal' },
      { name: 'vehicleName', label: 'Vehículo' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'isHermosillo', label: 'Es Hermosillo (oculta HORA)', dataType: 'boolean' },
      { name: 'rows', label: 'Filas de paquetes' },
    ] },
];

interface SeedRepos {
  tplRepo: Repository<DocumentTemplate>;
  verRepo: Repository<DocumentTemplateVersion>;
  varRepo: Repository<TemplateVariableDef>;
}

/** Upsert idempotente por code. */
export async function seedPdfTemplates(repos: SeedRepos): Promise<void> {
  for (const seed of PDF_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) {
      template = await repos.tplRepo.save(repos.tplRepo.create({
        code: seed.code, name: seed.name, type: 'pdf', language: 'es', active: true, category: 'reporte',
      }));
    }
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) {
      version = await repos.verRepo.save(repos.verRepo.create({
        templateId: template.id, version: 1, status: 'published',
        subject: null, designJson: seed.doc, compiledBody: null, engine: 'handlebars',
        changelog: 'Seed inicial PDF (fiel a pdfmake legacy)', publishedAt: new Date(),
      }));
    }
    if (!template.currentVersionId) { template.currentVersionId = version.id; await repos.tplRepo.save(template); }
    const existing = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existing.length === 0) {
      await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({
        templateId: template.id, name: v.name, label: v.label, dataType: (v.dataType as any) ?? 'string', example: null, required: false,
      })));
    }
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- pdf-templates.seed`
Expected: PASS (3 tests).

- [ ] **Step 5: Enganchar al seed general**

En `src/seed/seed-utils.ts`, junto a la llamada a `seedEmailTemplates`, importar y llamar `seedPdfTemplates(...)` con los mismos 3 repos (tpl/ver/var) del DataSource. Additivo, no tocar lo existente.

- [ ] **Step 6: Commit**

```bash
git add src/documents/seeds/pdf-templates.seed.ts src/documents/seeds/pdf-templates.seed.spec.ts src/seed/seed-utils.ts
git commit -m "feat(documents): seed warehouse_dispatch_pdf como PdfDoc (fiel), enganchado al seed"
```

---

## Task 4: Wire `warehouse.service` al motor (con fallback legacy)

**Files:**
- Modify: `src/warehouse/warehouse.service.ts`
- Create: `src/warehouse/warehouse-pdf.mapper.spec.ts`

**Interfaces:**
- Consumes: `TemplateService.render('warehouse_dispatch_pdf', data)`.
- Produces: `generatePdfBuffer(header, packages)` intenta el motor; si no hay `buffer` (Chromium ausente/falla), cae al generador `pdfmake` legacy (renombrado `generatePdfBufferLegacy`). Un helper puro `buildWarehousePdfData(header, packages, timeZone)` arma `{ title, subsidiaryName, vehicleName, totalPackages, trackingNumber, isHermosillo, rows }` (datos + flags en código).

- [ ] **Step 1: Escribir el test que falla (mapper de datos puro)**

```ts
// src/warehouse/warehouse-pdf.mapper.spec.ts
import { buildWarehousePdfData } from './warehouse.service';

describe('buildWarehousePdfData', () => {
  it('arma title, flags e isHermosillo + filas con rowClass/payment', () => {
    const header: any = { title: 'SALIDA A RUTA', subsidiary: { name: 'Cd. Obregón' }, vehicle: { name: 'V1' }, trackingNumber: 'T1' };
    const pkgs: any[] = [
      { trackingNumber: 'G1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000', recipientPhone: '644', isCharge: true, payment: { amount: 100 }, commitDateTime: new Date() },
    ];
    const d = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(d.title).toBe('SALIDA A RUTA');
    expect(d.subsidiaryName).toBe('Cd. Obregón');
    expect(d.isHermosillo).toBe(false);
    expect(d.totalPackages).toBe(1);
    expect(d.rows[0].trackingNumber).toBe('G1');
    expect(d.rows[0].payment).toContain('100');   // cobro formateado
    expect(['pago', '', 'vencehoy']).toContain(d.rows[0].rowClass);
    expect(d.rows[0].index).toBe(1);
  });

  it('isHermosillo true cuando la sucursal contiene hermosillo', () => {
    const d = buildWarehousePdfData({ title: 'X', subsidiary: { name: 'Hermosillo Centro' }, vehicle: {}, trackingNumber: '' } as any, [], 'America/Hermosillo');
    expect(d.isHermosillo).toBe(true);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- warehouse-pdf.mapper`
Expected: FAIL (`buildWarehousePdfData` no existe / no exportado).

- [ ] **Step 3: Implementar el mapper + wire, conservando legacy**

En `src/warehouse/warehouse.service.ts`:
1. Inyectar `TemplateService` en el constructor (import `from 'src/documents/template.service'`); asegurar que `WarehouseModule` importe `DocumentsModule` (agregar a `imports`).
2. Exportar una función pura a nivel de módulo (fuera de la clase) para poder testearla:

```ts
export function buildWarehousePdfData(header: any, packages: any[], timeZone: string) {
  const { format } = require('date-fns');
  const { toZonedTime } = require('date-fns-tz');
  const subsidiaryName = String(header?.subsidiary?.name ?? '');
  const isHermosillo = subsidiaryName.toLowerCase().includes('hermosillo');
  const todayStr = format(toZonedTime(new Date(), timeZone), 'yyyy-MM-dd');
  const rows = packages.map((pkg, i) => {
    const amount = pkg.payment?.amount ?? pkg.paymentAmount ?? 0;
    const commit = pkg.commitDateTime ? toZonedTime(new Date(pkg.commitDateTime), timeZone) : null;
    const dateStr = commit ? format(commit, 'yyyy-MM-dd') : '';
    const venceHoy = dateStr === todayStr;
    return {
      index: i + 1,
      trackingNumber: pkg.trackingNumber || pkg.dhlUniqueId || '',
      recipientName: pkg.recipientName ?? '',
      recipientAddress: pkg.recipientAddress ?? '',
      recipientZip: pkg.recipientZip ?? '',
      payment: pkg.isCharge ? `$${amount}` : 'N/A',
      date: dateStr,
      time: commit ? format(commit, 'HH:mm:ss') : '',
      recipientPhone: pkg.recipientPhone ?? '',
      signature: '',
      rowClass: pkg.isCharge ? 'pago' : (venceHoy ? 'vencehoy' : ''),
    };
  });
  return {
    title: header?.title ?? 'SALIDA A RUTA',
    subsidiaryName, vehicleName: header?.vehicle?.name ?? 'N/A',
    totalPackages: packages.length, trackingNumber: header?.trackingNumber ?? '',
    isHermosillo, rows,
  };
}
```

3. Renombrar el método actual `generatePdfBuffer` a `generatePdfBufferLegacy` (SIN cambiar su cuerpo pdfmake). Crear el nuevo `generatePdfBuffer`:

```ts
  private async generatePdfBuffer(header: NotificationHeader, packages: any[]): Promise<Buffer> {
    try {
      const data = buildWarehousePdfData(header, packages, this.timeZone);
      const r = await this.templateService.render('warehouse_dispatch_pdf', data);
      if (r.buffer) return r.buffer;
      this.logger?.warn?.('PDF por motor sin buffer; usando generador legacy');
    } catch (e: any) {
      this.logger?.warn?.(`PDF por motor falló (${e?.message}); usando generador legacy`);
    }
    return this.generatePdfBufferLegacy(header, packages);
  }
```

(Si la clase no tiene `logger`, usar `console.warn`.)

- [ ] **Step 4: Correr tests + build**

Run: `npm test -- warehouse-pdf.mapper && npm run build`
Expected: PASS; build OK (DI: WarehouseModule importa DocumentsModule → TemplateService resuelve).

- [ ] **Step 5: Verificar arranque**

Run: `node dist/main.js` (tras build); esperar `Nest application successfully started`; detener.
Expected: sin errores de DI.

- [ ] **Step 6: Commit + graph**

```bash
git add src/warehouse/warehouse.service.ts src/warehouse/warehouse-pdf.mapper.spec.ts src/warehouse/warehouse.module.ts
git commit -m "feat(warehouse): PDF de salida por el motor de plantillas con fallback a pdfmake legacy"
graphify update .
```

---

## Self-Review (autor)

- **Cobertura del spec (Etapa 3a):** `PdfDoc` §3.2 → T1; `PdfHtmlComposer` §4 → T1; `PdfRenderer` (Chromium) §4 → T2; seed fiel del warehouse PDF §5 → T3; wire con datos en código + fallback legacy §5 → T4. Los 5 PDFs del frontend → Etapa 3b (plan aparte).
- **Consistencia de tipos:** `PdfDoc`, `PdfHtmlComposer.compose(doc):string`, `HtmlToPdfService.convert(html):Promise<Buffer>`, `PdfRenderer(engine,composer,htmlToPdf)`, `buildWarehousePdfData(header,packages,timeZone)` — idénticos entre tareas.
- **Never-throws / fallback:** `PdfRenderer` no lanza (devuelve sin buffer si Chromium falla); `warehouse.generatePdfBuffer` cae a `generatePdfBufferLegacy` (pdfmake) si no hay buffer — nada se rompe si Chromium no está desplegado.
- **Presentación vs datos:** la plantilla `PdfDoc` define columnas/anchos/colores/variante HORA; el código (`buildWarehousePdfData`) computa filas, flags (`rowClass`, `isHermosillo`), cobro. Paridad con §B1.
- **Riesgo:** Chromium debe existir en producción (`CHROMIUM_PATH` o Chrome instalado); mientras no, el fallback legacy mantiene la operación. Paridad visual exacta se valida generando un PDF real cuando haya Chromium (verificación manual).
- **Tests:** el único punto no unit-testeado es la llamada real a Chromium (`HtmlToPdfService`), aislada y mockeada en el test de `PdfRenderer`.
