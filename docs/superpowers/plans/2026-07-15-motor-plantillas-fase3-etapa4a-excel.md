# Motor de Plantillas — Fase 3 Etapa 4a: Motor Excel + primer reporte fiel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el `ExcelRenderer` (modelo `ExcelDoc` → `exceljs` Workbook) y recrear fielmente el primer reporte Excel (`audit_log_excel`, una hoja) como plantilla de presentación — con datos en código. Establece el patrón para los 12 Excel restantes (lotes posteriores).

**Architecture:** Un `ExcelWorkbookBuilder` puro toma un `ExcelDoc` (hojas/columnas/estilos) + el `RenderContext` (datos que pasa el código) y produce un `Buffer` xlsx con `exceljs`; interpola solo títulos/subtítulos/etiquetas con el `TemplateEngine` (las filas de datos se usan tal cual por `key`). `ExcelRenderer` (format='excel') lo envuelve. Excel es determinista → todo unit-testeable sin navegador.

**Tech Stack:** NestJS, `exceljs` (ya dep), Handlebars (TemplateEngine, Fase 1), Jest. Presentación en plantilla; datos/lógica en código.

## Global Constraints

- Repo `D:\PMY\pmy-api`, branch **`feat/template-engine-phase3`**. NO mergear a main.
- Hook **graphify**: `graphify query "<pregunta>"` antes de leer/editar cualquier fuente.
- `render()` nunca lanza (Fase 1). `ExcelRenderer` no lanza: si el build falla, loguea y devuelve `RenderResult` sin `buffer` (el llamador cae a su generador legacy).
- Presentación (columnas: key/label/width/numFmt/align; título; estilos de encabezado; freeze; autofilter; multi-hoja) en la plantilla `ExcelDoc`. **Datos y lógica** (filas, agregaciones, semáforos, formateo previo de fechas) en código, pasados en `render(code, data)`. Las filas llegan como `ctx.data[<rowsVar>]` (array de objetos mapeados por `column.key`).
- Paridad con el inventario (docs/superpowers/references/document-inventory.md). Este plan cubre `audit_log_excel` (§B9). Los demás Excel son lotes posteriores.
- `RenderResult` (Fase 1) tiene `buffer?`, `mime`, `filename?`.
- Tests: Jest unit; para Excel se puede reconstruir el Workbook con `exceljs` y aserciones sobre celdas/estilos (sin navegador).

---

## Task 1: `ExcelDoc` types + `ExcelWorkbookBuilder`

**Files:**
- Create: `src/documents/blocks/excel-doc.types.ts`
- Create: `src/documents/blocks/excel-workbook-builder.ts`
- Create: `src/documents/blocks/excel-workbook-builder.spec.ts`

**Interfaces:**
- Consumes: `TemplateEngine.render` (para interpolar strings de presentación), `RenderContext`.
- Produces: tipos `ExcelColumn`/`ExcelSheet`/`ExcelDoc`; `ExcelWorkbookBuilder.build(doc: ExcelDoc, ctx: RenderContext): Promise<Buffer>`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/blocks/excel-workbook-builder.spec.ts
import * as ExcelJS from 'exceljs';
import { ExcelWorkbookBuilder } from './excel-workbook-builder';
import { ExcelDoc } from './excel-doc.types';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'x', env: 'test' } };
}
async function load(buf: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); return wb; }

const builder = new ExcelWorkbookBuilder(new (require('../template-engine').TemplateEngine)());

describe('ExcelWorkbookBuilder.build', () => {
  const doc: ExcelDoc = { sheets: [{
    name: 'Auditoría',
    headerFont: { bold: true },
    columns: [
      { key: 'createdAt', label: 'Fecha', width: 22 },
      { key: 'userEmail', label: 'Usuario', width: 28 },
      { key: 'amount', label: 'Importe', width: 14, numFmt: '"$"#,##0.00', align: 'right' },
    ],
    rowsVar: 'rows',
  }] };

  it('crea la hoja con encabezados y una fila de datos', async () => {
    const buf = await builder.build(doc, ctx({ rows: [{ createdAt: '2026-07-16', userEmail: 'a@x.com', amount: 12.5 }] }));
    const wb = await load(buf);
    const ws = wb.getWorksheet('Auditoría')!;
    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe('Fecha');
    expect(header.getCell(2).value).toBe('Usuario');
    const dataRow = ws.getRow(2);
    expect(dataRow.getCell(1).value).toBe('2026-07-16');
    expect(dataRow.getCell(2).value).toBe('a@x.com');
    expect(dataRow.getCell(3).value).toBe(12.5);
  });

  it('aplica numFmt, ancho y encabezado en negrita', async () => {
    const buf = await builder.build(doc, ctx({ rows: [] }));
    const wb = await load(buf);
    const ws = wb.getWorksheet('Auditoría')!;
    expect(ws.getColumn(3).numFmt).toBe('"$"#,##0.00');
    expect(ws.getColumn(1).width).toBe(22);
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
  });

  it('interpola el título con datos y lo fusiona', async () => {
    const withTitle: ExcelDoc = { sheets: [{ name: 'R', title: 'REPORTE - {{sub}}', columns: [{ key: 'a', label: 'A' }], rowsVar: 'rows' }] };
    const buf = await builder.build(withTitle, ctx({ sub: 'OBREGÓN', rows: [] }));
    const wb = await load(buf);
    const ws = wb.getWorksheet('R')!;
    expect(ws.getRow(1).getCell(1).value).toBe('REPORTE - OBREGÓN'); // título interpolado en fila 1
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- excel-workbook-builder`
Expected: FAIL (módulos no existen).

- [ ] **Step 3: Implementar los tipos**

```ts
// src/documents/blocks/excel-doc.types.ts
export interface ExcelColumn {
  key: string;
  label: string;
  width?: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
}

export interface ExcelSheet {
  name: string;
  /** Título en fila 1 fusionada (admite {{var}}). */
  title?: string;
  titleFill?: string;   // argb hex (p.ej. 'ef883a')
  /** Filas de texto etiqueta:valor antes de la tabla (value admite {{var}}). */
  infoRows?: { label: string; value: string }[];
  headerFill?: string;  // argb hex del encabezado de columnas
  headerFont?: { bold?: boolean; color?: string };
  freezeHeader?: boolean;
  autoFilter?: boolean;
  columns: ExcelColumn[];
  /** Nombre de la variable-lista con las filas (ctx.data[rowsVar]). */
  rowsVar: string;
}

export interface ExcelDoc { sheets: ExcelSheet[]; }
```

- [ ] **Step 4: Implementar el builder**

```ts
// src/documents/blocks/excel-workbook-builder.ts
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { TemplateEngine } from '../template-engine';
import { RenderContext } from '../documents.types';
import { ExcelDoc, ExcelSheet } from './excel-doc.types';

/** Construye un xlsx desde un ExcelDoc + datos (ctx.data[rowsVar]). Presentación en la plantilla. */
@Injectable()
export class ExcelWorkbookBuilder {
  constructor(private readonly engine: TemplateEngine) {}

  async build(doc: ExcelDoc, ctx: RenderContext): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    for (const sheet of doc.sheets ?? []) this.buildSheet(wb, sheet, ctx);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  private buildSheet(wb: ExcelJS.Workbook, sheet: ExcelSheet, ctx: RenderContext) {
    const ws = wb.addWorksheet(sheet.name);
    const lastCol = Math.max(sheet.columns.length, 1);

    // Título (fila fusionada) + info rows, antes de la tabla.
    if (sheet.title) {
      const row = ws.addRow([this.engine.render(sheet.title, ctx)]);
      ws.mergeCells(row.number, 1, row.number, lastCol);
      row.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      if (sheet.titleFill) {
        for (let c = 1; c <= lastCol; c++) ws.getCell(row.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sheet.titleFill } };
      }
    }
    for (const info of sheet.infoRows ?? []) {
      ws.addRow([`${info.label}: ${this.engine.render(info.value, ctx)}`]);
    }

    // Encabezado de columnas.
    const headerRow = ws.addRow(sheet.columns.map((c) => c.label));
    if (sheet.headerFont?.bold || sheet.headerFont?.color) {
      headerRow.font = { bold: !!sheet.headerFont.bold, ...(sheet.headerFont.color ? { color: { argb: sheet.headerFont.color } } : {}) };
    }
    if (sheet.headerFill) headerRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sheet.headerFill! } }; });

    // Ancho, numFmt y alineación por columna (por índice, no via ws.columns para no pisar filas de título).
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.width != null) col.width = c.width;
      if (c.numFmt) col.numFmt = c.numFmt;
      if (c.align) col.alignment = { horizontal: c.align };
    });

    // Filas de datos.
    const rows: any[] = Array.isArray(ctx.data?.[sheet.rowsVar]) ? ctx.data[sheet.rowsVar] : [];
    for (const r of rows) ws.addRow(sheet.columns.map((c) => r?.[c.key] ?? ''));

    if (sheet.freezeHeader) ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
    if (sheet.autoFilter) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: lastCol } };
  }
}
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -- excel-workbook-builder`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/documents/blocks/excel-doc.types.ts src/documents/blocks/excel-workbook-builder.ts src/documents/blocks/excel-workbook-builder.spec.ts
git commit -m "feat(documents): ExcelDoc + ExcelWorkbookBuilder (ExcelDoc+datos -> xlsx)"
```

---

## Task 2: `ExcelRenderer` + registro

**Files:**
- Create: `src/documents/renderers/excel.renderer.ts`
- Create: `src/documents/renderers/excel.renderer.spec.ts`
- Modify: `src/documents/documents.module.ts`

**Interfaces:**
- Consumes: `ExcelWorkbookBuilder.build`, `RenderContext`/`RenderResult`, `DocumentRenderer`.
- Produces: `ExcelRenderer` (`format='excel'`): construye desde `version.designJson` (ExcelDoc) + `ctx` → `RenderResult{ format:'excel', mime, buffer }`. Nunca lanza (sin buffer si falla). Registrado en `DOCUMENT_RENDERERS = [email, pdf, excel]`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/renderers/excel.renderer.spec.ts
import { ExcelRenderer } from './excel.renderer';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { TemplateEngine } from '../template-engine';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) { return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'x', env: 'test' } }; }

describe('ExcelRenderer', () => {
  const r = new ExcelRenderer(new ExcelWorkbookBuilder(new TemplateEngine()));

  it('produce buffer xlsx con el mime correcto', async () => {
    const v: any = { designJson: { sheets: [{ name: 'H', columns: [{ key: 'a', label: 'A' }], rowsVar: 'rows' }] } };
    const out = await r.render(v, ctx({ rows: [{ a: 1 }] }));
    expect(out.format).toBe('excel');
    expect(out.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out.buffer).toBeInstanceOf(Buffer);
    expect(out.buffer!.length).toBeGreaterThan(0);
  });

  it('nunca lanza: si el build falla, devuelve sin buffer', async () => {
    const badBuilder: any = { build: () => Promise.reject(new Error('boom')) };
    const r2 = new ExcelRenderer(badBuilder);
    const out = await r2.render({ designJson: { sheets: [] } } as any, ctx({}));
    expect(out.format).toBe('excel');
    expect(out.buffer).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- excel.renderer`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/documents/renderers/excel.renderer.ts
import { Injectable, Logger } from '@nestjs/common';
import { DocumentFormat } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { RenderContext, RenderResult } from '../documents.types';
import { DocumentRenderer } from './renderer.interface';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class ExcelRenderer implements DocumentRenderer {
  readonly format: DocumentFormat = 'excel';
  private readonly logger = new Logger(ExcelRenderer.name);

  constructor(private readonly builder: ExcelWorkbookBuilder) {}

  async render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult> {
    const doc: any = version.designJson;
    try {
      const buffer = await this.builder.build(doc, ctx);
      return { format: 'excel', mime: XLSX_MIME, buffer };
    } catch (e: any) {
      this.logger.warn(`build Excel falló: ${e?.message}`);
      return { format: 'excel', mime: XLSX_MIME };
    }
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- excel.renderer`
Expected: PASS (2 tests).

- [ ] **Step 5: Registrar en el módulo**

En `src/documents/documents.module.ts`: importar `ExcelWorkbookBuilder`, `ExcelRenderer`; añadirlos a `providers`; actualizar la factory:

```ts
{ provide: DOCUMENT_RENDERERS, useFactory: (email: EmailRenderer, pdf: PdfRenderer, excel: ExcelRenderer) => [email, pdf, excel], inject: [EmailRenderer, PdfRenderer, ExcelRenderer] },
```

- [ ] **Step 6: Build + suite documents**

Run: `npm run build && npx jest src/documents`
Expected: compila; suite verde.

- [ ] **Step 7: Commit**

```bash
git add src/documents/renderers/excel.renderer.ts src/documents/renderers/excel.renderer.spec.ts src/documents/documents.module.ts
git commit -m "feat(documents): ExcelRenderer (ExcelDoc -> xlsx) registrado en el motor"
```

---

## Task 3: Seed `audit_log_excel` (ExcelDoc fiel §B9)

**Files:**
- Modify: `src/documents/seeds/pdf-templates.seed.ts` → renombrar conceptualmente a "report seeds": crear `src/documents/seeds/excel-templates.seed.ts`
- Create: `src/documents/seeds/excel-templates.seed.spec.ts`
- Modify: `src/seed/seed-utils.ts` (invocar el seed de Excel)

**Interfaces:**
- Produces: `EXCEL_TEMPLATE_SEEDS` + `seedExcelTemplates(repos)` (upsert idempotente por `code`, `type:'excel'`, v1 publicada con `designJson = ExcelDoc`). Primer seed: `audit_log_excel`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/documents/seeds/excel-templates.seed.spec.ts
import { seedExcelTemplates, EXCEL_TEMPLATE_SEEDS } from './excel-templates.seed';

function repos() {
  const templates: any[] = []; const versions: any[] = []; const vars: any[] = [];
  return {
    tplRepo: { findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.code === where.code) ?? null), create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }), save: (t: any) => { if (!templates.find((x) => x.id === t.id)) templates.push(t); return Promise.resolve(t); } },
    verRepo: { findOne: ({ where }: any) => Promise.resolve(versions.find((v) => v.templateId === where.templateId && v.version === where.version) ?? null), create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }), save: (v: any) => { if (!versions.find((x) => x.id === v.id)) versions.push(v); return Promise.resolve(v); } },
    varRepo: { find: ({ where }: any) => Promise.resolve(vars.filter((x) => x.templateId === where.templateId)), create: (d: any) => d, save: (arr: any[]) => { vars.push(...arr); return Promise.resolve(arr); } },
    _state: { templates, versions, vars },
  };
}

describe('seedExcelTemplates', () => {
  it('siembra audit_log_excel como type excel con ExcelDoc (11 columnas)', async () => {
    const r = repos();
    await seedExcelTemplates(r as any);
    const t = r._state.templates.find((x: any) => x.code === 'audit_log_excel');
    expect(t?.type).toBe('excel');
    const v = r._state.versions.find((x: any) => x.templateId === t.id);
    expect(v.designJson.sheets[0].name).toBe('Auditoría');
    expect(v.designJson.sheets[0].columns.length).toBe(11);
  });

  it('es idempotente', async () => {
    const r = repos(); await seedExcelTemplates(r as any); await seedExcelTemplates(r as any);
    expect(r._state.templates.filter((t: any) => t.code === 'audit_log_excel').length).toBe(1);
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- excel-templates.seed`
Expected: FAIL.

- [ ] **Step 3: Implementar el seed (fiel §B9)**

```ts
// src/documents/seeds/excel-templates.seed.ts
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { ExcelDoc } from '../blocks/excel-doc.types';

export interface ExcelSeedVar { name: string; label: string; dataType?: string; }
export interface ExcelSeed { code: string; name: string; doc: ExcelDoc; variables: ExcelSeedVar[]; }

/** audit_log_excel — hoja "Auditoría", 11 columnas, encabezado en negrita (inventario §B9). */
const auditLog: ExcelDoc = {
  sheets: [{
    name: 'Auditoría',
    headerFont: { bold: true },
    columns: [
      { key: 'createdAt', label: 'Fecha', width: 22 },
      { key: 'userEmail', label: 'Usuario', width: 28 },
      { key: 'userName', label: 'Nombre', width: 24 },
      { key: 'role', label: 'Rol', width: 12 },
      { key: 'module', label: 'Módulo', width: 18 },
      { key: 'subsidiaryName', label: 'Sucursal', width: 22 },
      { key: 'action', label: 'Acción', width: 14 },
      { key: 'entityId', label: 'Registro', width: 26 },
      { key: 'result', label: 'Resultado', width: 12 },
      { key: 'ip', label: 'IP', width: 16 },
      { key: 'description', label: 'Descripción', width: 50 },
    ],
    rowsVar: 'rows',
  }],
};

export const EXCEL_TEMPLATE_SEEDS: ExcelSeed[] = [
  { code: 'audit_log_excel', name: 'Auditoría (Excel)', doc: auditLog,
    variables: [{ name: 'rows', label: 'Filas de auditoría (createdAt ya formateado es-MX en código)' }] },
];

interface SeedRepos { tplRepo: Repository<DocumentTemplate>; verRepo: Repository<DocumentTemplateVersion>; varRepo: Repository<TemplateVariableDef>; }

export async function seedExcelTemplates(repos: SeedRepos): Promise<void> {
  for (const seed of EXCEL_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) template = await repos.tplRepo.save(repos.tplRepo.create({ code: seed.code, name: seed.name, type: 'excel', language: 'es', active: true, category: 'reporte' }));
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) version = await repos.verRepo.save(repos.verRepo.create({ templateId: template.id, version: 1, status: 'published', subject: null, designJson: seed.doc, compiledBody: null, engine: 'handlebars', changelog: 'Seed inicial Excel (fiel a exceljs legacy)', publishedAt: new Date() }));
    if (!template.currentVersionId) { template.currentVersionId = version.id; await repos.tplRepo.save(template); }
    const existing = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existing.length === 0) await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({ templateId: template.id, name: v.name, label: v.label, dataType: (v.dataType as any) ?? 'string', example: null, required: false })));
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- excel-templates.seed`
Expected: PASS (2 tests).

- [ ] **Step 5: Enganchar al seed general**

En `src/seed/seed-utils.ts`, junto a `seedEmailTemplates`/`seedPdfTemplates`, importar y llamar `seedExcelTemplates(...)` con los 3 repos. Additivo.

- [ ] **Step 6: Commit**

```bash
git add src/documents/seeds/excel-templates.seed.ts src/documents/seeds/excel-templates.seed.spec.ts src/seed/seed-utils.ts
git commit -m "feat(documents): seed audit_log_excel como ExcelDoc (fiel §B9), enganchado"
```

---

## Task 4: Wire `audit.controller` exportExcel al motor (con fallback legacy)

**Files:**
- Modify: `src/audit/audit.controller.ts`
- Modify: `src/audit/audit.module.ts` (importar `DocumentsModule` si falta)
- Create: `src/audit/audit-excel.mapper.spec.ts`

**Interfaces:**
- Consumes: `TemplateService.render('audit_log_excel', { rows })`.
- Produces: `exportExcel` obtiene las filas (formateando `createdAt` a es-MX en código, como el legacy), intenta `render('audit_log_excel', { rows })`; si hay `buffer` lo escribe al `res`; si no, cae al armado inline legacy actual (conservado). Helper puro exportado `buildAuditExcelRows(rows)` (formatea createdAt).

- [ ] **Step 1: Escribir el test que falla (mapper puro)**

```ts
// src/audit/audit-excel.mapper.spec.ts
import { buildAuditExcelRows } from './audit.controller';

describe('buildAuditExcelRows', () => {
  it('formatea createdAt a string local y conserva los campos', () => {
    const rows = buildAuditExcelRows([{ createdAt: '2026-07-16T10:00:00Z', userEmail: 'a@x.com', module: 'auth', action: 'login', description: 'x' }]);
    expect(typeof rows[0].createdAt).toBe('string');
    expect(rows[0].createdAt.length).toBeGreaterThan(0);
    expect(rows[0].userEmail).toBe('a@x.com');
    expect(rows[0].module).toBe('auth');
  });

  it('createdAt vacío -> cadena vacía', () => {
    const rows = buildAuditExcelRows([{ userEmail: 'a@x.com' } as any]);
    expect(rows[0].createdAt).toBe('');
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- audit-excel.mapper`
Expected: FAIL (no exportado).

- [ ] **Step 3: Implementar el mapper + wire (conservando legacy)**

En `src/audit/audit.controller.ts`:
1. Inyectar `TemplateService` (import `from 'src/documents/template.service'`); asegurar `DocumentsModule` en `audit.module.ts` imports (agregar solo si falta).
2. Exportar la función pura a nivel módulo:

```ts
export function buildAuditExcelRows(rows: any[]): any[] {
  return (rows ?? []).map((r) => ({
    ...r,
    createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('es-MX') : '',
  }));
}
```

3. En `exportExcel(q, res)`: tras obtener `const raw = await this.audit.findForExport(q);`, intentar el motor y caer al armado inline actual como fallback:

```ts
    const rows = buildAuditExcelRows(raw);
    try {
      const r = await this.templates.render('audit_log_excel', { rows });
      if (r.buffer) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="auditoria.xlsx"');
        res.end(r.buffer);
        return;
      }
    } catch { /* cae a legacy */ }
    // ----- LEGACY (armado inline actual con ExcelJS) como fallback -----
    // (dejar el código existente de creación del Workbook + res tal cual, debajo)
```

(El bloque legacy existente — `new ExcelJS.Workbook()`, `ws.columns=[...]`, `wb.xlsx.write(res)` — se conserva íntegro como fallback.)

- [ ] **Step 4: Correr tests + build**

Run: `npm test -- audit-excel.mapper && npm run build`
Expected: PASS; build OK (DI: audit.module importa DocumentsModule).

- [ ] **Step 5: Verificar arranque**

Run: `node dist/main.js` → `Nest application successfully started`; detener.
Expected: sin errores DI.

- [ ] **Step 6: Commit + graph**

```bash
git add src/audit/audit.controller.ts src/audit/audit.module.ts src/audit/audit-excel.mapper.spec.ts
git commit -m "feat(audit): exportExcel por el motor de plantillas con fallback al armado legacy"
graphify update .
```

---

## Self-Review (autor)

- **Cobertura del spec (Etapa 4a):** `ExcelDoc` §3.3 → T1; builder → T1; `ExcelRenderer` §4 → T2; seed fiel + hook §5 → T3; wire con datos en código + fallback legacy §5 → T4. Los 12 Excel restantes (driver report multi-hoja/semáforo, income statement columnas dinámicas por día, inventory/shipments 67, etc.) y los 5 del frontend → lotes posteriores (mismo patrón: ExcelDoc + data-provider + render + fallback).
- **Consistencia de tipos:** `ExcelDoc`, `ExcelWorkbookBuilder.build(doc,ctx):Promise<Buffer>`, `ExcelRenderer(builder)`, `buildAuditExcelRows(rows)` — idénticos entre tareas.
- **Never-throws:** `ExcelRenderer` no lanza (sin buffer si falla); `audit.exportExcel` cae al armado legacy si no hay buffer.
- **Verificable aquí:** Excel es determinista — los tests reconstruyen el Workbook con exceljs y asertan columnas/estilos/valores SIN navegador (a diferencia del PDF).
- **Riesgo/pendiente:** el ExcelDoc de esta etapa cubre una sola hoja simple; multi-hoja ya lo soporta el builder (`sheets[]`), pero columnas dinámicas por día (income statement) y reglas condicionales/semáforo (driver report, shipments 67) requerirán extender el esquema/builder en los lotes que los aborden.
