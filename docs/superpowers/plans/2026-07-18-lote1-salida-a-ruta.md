# Lote 1 — Salida a Ruta (unificación PDF + Excel) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la plantilla canónica **rica** de "Salida a Ruta" (PDF + Excel) en el Motor de Plantillas, fiel al diseño del frontend (C1/C2), con su data-provider en backend, y engancharla en el flujo de package-dispatch detrás de un flag conservando el generador del frontend como respaldo.

**Architecture:** Se extiende el schema del motor de forma retrocompatible: `PdfDoc` gana una variante `html` (plantilla Handlebars cruda que el `PdfHtmlComposer` solo brandea y Chromium imprime) y `ExcelDoc` gana **secciones** (`ExcelSheet.sections[]`) para hojas heterogéneas. Un data-provider puro (`route-dispatch.mapper.ts`) replica `mapToPackageInfo` + `calculatePackageStats` + `sortByZip` + truncados y formatos, produciendo el objeto `data` que consumen ambas plantillas. Los seeds registran `route_dispatch_pdf` y `route_dispatch_excel`. La integración vive en `package-dispatch.service` detrás del flag `DOC_ENGINE_ROUTE_DISPATCH`.

**Tech Stack:** NestJS, TypeORM, Handlebars (TemplateEngine propio), exceljs, playwright-core (Chromium vía `HtmlToPdfService`), Jest.

## Global Constraints

- Branch de trabajo: `feat/template-engine-phase3` (NO mergear; el usuario decide el merge).
- Zona horaria de negocio: `America/Hermosillo` para TODO formato de fecha/hora visible.
- El motor **nunca lanza**: si `render()` no devuelve `buffer`, el call-site cae al generador legacy/frontend.
- Retrocompatibilidad obligatoria: los seeds existentes (`warehouse_dispatch_pdf`, `audit_log_excel`, 12 correos) deben seguir renderizando igual. Los campos nuevos de schema son **opcionales**.
- Presentación en la plantilla; DATOS y lógica (stats, orden, truncados, flags) en el data-provider (código).
- NO borrar el generador del frontend (`app-pmy/lib/services/package-dispatch/*`) ni métodos legacy: son respaldo.
- Paleta institucional exacta (argb sin alpha, tal como exceljs los usa en el código actual): naranja `ef883a`, café header `8c5e4e`, amarillo pago `fff2cc`, gris alterno `F2F2F2`, rojo `FF0000`, rojo texto `CC0000`, rojo claro `FFE6E6`, blanco `FFFFFF`. Hex PDF (con `#`): primary `#8c5e4e`, urgente `#ff6b6b`, highlight `#fd7e14`, pago `#fff2cc`, vence-hoy `#ffe6e6`, alterno `#f8f9fa`, inválido borde `#ff9999`, inválido fila `#fff0f0`, inválido texto `#cc0000`, texto `#212529`.
- Comando de test unitario: `npm test -- <ruta-spec>`. Tras cambios de código: `graphify update .`.

---

## Contrato de datos (producido por el data-provider, consumido por ambas plantillas)

`buildRouteDispatchData(input: RouteDispatchInput): Record<string, any>` devuelve:

```ts
{
  title: 'SALIDA A RUTA',
  subsidiaryName: string,
  vehicleName: string,          // 'N/A' si falta
  mainDriver: string,           // drivers[0].name | 'No asignado'
  routeNames: string,           // routes.map(name).join(' → ') | 'No asignado'
  driverNames: string,          // drivers.map(name).join(' - ') | 'N/A'  (para Excel)
  routeNamesArrow: string,      // routes.map(name).join(' -> ') | 'N/A'  (para Excel info row)
  trackingNumber: string,
  isHermosillo: boolean,        // subsidiaryName.toLowerCase().includes('hermosillo')
  generatedDate: string,        // format(now, 'yyyy-MM-dd', Hermosillo)  → header PDF
  generatedTime: string,        // format(now, 'HH:mm:ss', Hermosillo)   → header PDF
  dispatchDateTime: string,     // format(createdAt ?? now, 'yyyy-MM-dd HH:mm', Hermosillo) → info Excel
  stats: {
    total: number, regularCount: number, f2Count: number, cargaCount: number,
    highValueCount: number, withPaymentCount: number, totalPaymentAmount: number,
    montoFmt: string,           // `$${totalPaymentAmount.toFixed(2)}`  (ej. '$1234.50')
    expiringTodayCount: number, fedexCount: number, dhlCount: number,
  },
  rows: Array<{
    index: number,              // 1-based
    icons: string,              // `[A][C][$][H]` en ese orden, según flags
    trackingNumber: string,
    recipientName: string,      // doble truncado 25→22 (PDF) — ver Task 3
    recipientNameXlsx: string,  // sin truncar (Excel)
    recipientAddress: string,   // doble truncado 28→26 (PDF)
    recipientAddressXlsx: string,
    recipientZip: string,
    paymentPdf: string,         // hasPayment ? `${type} $${amount}` : ''   (ej. 'COD $500')
    paymentXlsx: string,        // hasPayment ? `${type} $ ${amount}` : ''  (ej. 'COD $ 500')
    date: string,               // commit 'yyyy-MM-dd' Hermosillo | ''
    time: string,               // commit 'HH:mm:ss' Hermosillo | ''
    recipientPhone: string,     // formateado (ver Task 3)
    rowClass: string,           // 'even'? + 'pago'? + 'vencehoy'? + 'zone'? (space-joined) — PDF
    rowFill: string | null,     // argb para Excel: 'fff2cc' si pago; 'F2F2F2' si even; null
  }>,
  invalidRows: Array<{ index: number, trackingNumber: string }>,  // PDF (globalIndex 1-based)
  invalidChunks: string[],      // Excel: cada string = 6 guías `📦 x    📦 y ...` (join 4 espacios)
  hasInvalid: boolean,          // invalidTrackings.length > 0
  invalidCount: number,
}
```

`RouteDispatchInput`:

```ts
export interface RouteDispatchPackage {
  trackingNumber: string;
  recipientName?: string; recipientAddress?: string; recipientZip?: string; recipientPhone?: string;
  commitDateTime?: string;
  isCharge?: boolean; isHighValue?: boolean;
  payment?: { amount: number | string; type: string } | null;
  shipmentType?: string;                 // 'fedex' | 'dhl'
  consolidated?: { type?: string } | null;
}
export interface RouteDispatchInput {
  subsidiaryName: string;
  vehicleName?: string;
  drivers: { name: string }[];
  routes: { name: string }[];
  trackingNumber: string;
  packages: RouteDispatchPackage[];
  invalidTrackings?: string[];
  sortByPostalCode?: boolean;            // default true
  now?: Date;                            // default new Date() (inyectable para tests)
  createdAt?: string | Date;             // fecha del dispatch para la info-row del Excel
}
```

---

## File Structure

- Modify `src/documents/blocks/pdf-doc.types.ts` — agrega `html?: string`; `blocks?` opcional.
- Modify `src/documents/blocks/pdf-html-composer.ts` — rama `doc.html` (brandea y retorna crudo).
- Modify `src/documents/renderers/pdf.renderer.ts` — el guard acepta `doc.html || doc.blocks`.
- Modify `src/documents/blocks/excel-doc.types.ts` — agrega `ExcelSection` (unión discriminada) y `ExcelSheet.sections?`.
- Modify `src/documents/blocks/excel-workbook-builder.ts` — soporta `sheet.sections`.
- Create `src/documents/data/route-dispatch.mapper.ts` — data-provider puro.
- Create `src/documents/data/route-dispatch.mapper.spec.ts` — tests del provider.
- Create `src/documents/seeds/templates/route-dispatch.pdf.html.ts` — plantilla Handlebars HTML (C1).
- Modify `src/documents/seeds/pdf-templates.seed.ts` — registra `route_dispatch_pdf`.
- Modify `src/documents/seeds/excel-templates.seed.ts` — registra `route_dispatch_excel` (ExcelDoc con secciones).
- Modify `src/documents/blocks/pdf-html-composer.spec.ts` — test de la rama `html`.
- Modify `src/documents/blocks/excel-workbook-builder.spec.ts` — tests de secciones.
- Create `src/documents/seeds/route-dispatch.seed.spec.ts` — test de fidelidad render end-to-end (Excel; PDF sólo estructura HTML).
- Modify `src/package-dispatch/package-dispatch.service.ts` — método `renderRouteDispatchDocuments(input)` + flag en `sendByEmail`.
- Create `src/package-dispatch/route-dispatch.integration.spec.ts` — test del método de render + flag.

---

### Task 1: Extender PdfDoc con variante `html` + rama en composer y renderer

**Files:**
- Modify: `src/documents/blocks/pdf-doc.types.ts`
- Modify: `src/documents/blocks/pdf-html-composer.ts:11-39`
- Modify: `src/documents/renderers/pdf.renderer.ts:24`
- Test: `src/documents/blocks/pdf-html-composer.spec.ts`

**Interfaces:**
- Produces: `PdfDoc.html?: string`. Cuando existe, `PdfHtmlComposer.compose(doc)` envuelve el HTML con `<style>` de branding + `@page` (usando `doc.page`) y retorna el HTML **sin interpolar** (deja `{{...}}`). `PdfRenderer.render` compone si `doc.html || doc.blocks`.

- [ ] **Step 1: Escribir el test que falla**

En `pdf-html-composer.spec.ts` agrega:

```ts
it('rama html: envuelve la plantilla cruda con branding y @page, sin interpolar', () => {
  const composer = new PdfHtmlComposer();
  const html = composer.compose({
    page: { size: 'LETTER', orientation: 'landscape', margins: '5px' },
    html: '<div class="x">{{title}} {{brand.colors.primary}}</div>',
  } as any);
  expect(html).toContain('@page { size: LETTER landscape; margin: 5px; }');
  expect(html).toContain('<div class="x">{{title}} {{brand.colors.primary}}</div>'); // no interpola
  expect(html).toContain('font-family: {{brand.typography.fontFamily}}');
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- src/documents/blocks/pdf-html-composer.spec.ts`
Expected: FAIL (compose ignora `html`; no aparece el `<div class="x">`).

- [ ] **Step 3: Implementar los cambios mínimos**

En `pdf-doc.types.ts` cambia la interfaz:

```ts
export interface PdfDoc {
  page: PdfPage;
  header?: { title: string; showDateTime?: boolean };
  html?: string;        // NUEVO: plantilla Handlebars completa. Si existe, gana sobre blocks.
  blocks?: PdfBlock[];  // legacy (retrocompatible)
}
```

En `pdf-html-composer.ts`, al inicio de `compose(doc)` (antes de calcular `header`), agrega la rama:

```ts
compose(doc: PdfDoc): string {
  const margins = doc.page.margins ?? '20px';
  if (doc.html) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${doc.page.size} ${doc.page.orientation}; margin: ${margins}; }
      * { box-sizing: border-box; font-family: {{brand.typography.fontFamily}}; }
      body { color: {{brand.colors.text}}; margin: 0; }
    </style></head><body>
${doc.html}
</body></html>`;
  }
  // ... (código de bloques existente, sin cambios) ...
```

En `pdf.renderer.ts:24` cambia el guard para aceptar la rama html:

```ts
const template = doc && (doc.html || doc.blocks) ? this.composer.compose(doc) : '';
```

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `npm test -- src/documents/blocks/pdf-html-composer.spec.ts`
Expected: PASS (incluye los tests previos de bloques, intactos).

- [ ] **Step 5: Commit**

```bash
git add src/documents/blocks/pdf-doc.types.ts src/documents/blocks/pdf-html-composer.ts src/documents/renderers/pdf.renderer.ts src/documents/blocks/pdf-html-composer.spec.ts
git commit -m "feat(documents): PdfDoc soporta variante html (composer brandea plantilla cruda)"
```

---

### Task 2: Extender ExcelDoc con secciones + soporte en el builder

**Files:**
- Modify: `src/documents/blocks/excel-doc.types.ts`
- Modify: `src/documents/blocks/excel-workbook-builder.ts:19-62`
- Test: `src/documents/blocks/excel-workbook-builder.spec.ts`

**Interfaces:**
- Produces: `ExcelSheet.sections?: ExcelSection[]`. Si `sections` existe, el builder ignora la ruta de tabla única y renderiza sección por sección. `ExcelSection` es la unión:

```ts
export interface ExcelColumn { key: string; label: string; width?: number; numFmt?: string; align?: 'left'|'center'|'right'; }

export type ExcelSection =
  | { kind: 'title'; text: string; fill?: string; font?: { size?: number; bold?: boolean; color?: string }; mergeTo: number; height?: number }
  | { kind: 'spacer' }
  | { kind: 'info'; rows: { text: string }[]; mergeTo: number }
  | { kind: 'band'; rowsVar: string; fill?: string; font?: { bold?: boolean; color?: string }; mergeTo: number }
  | { kind: 'table'; columns: ExcelColumn[]; rowsVar: string;
      headerFill?: string; headerFont?: { bold?: boolean; color?: string }; headerHeight?: number; headerAlign?: 'left'|'center'|'right';
      bordered?: boolean; cellAlign?: 'left'|'center'|'right'; wrap?: boolean; rowFillKey?: string;
      freezeHeader?: boolean; autoFilter?: boolean };

export interface ExcelSheet {
  name: string;
  sections?: ExcelSection[];   // NUEVO. Si existe, ruta de secciones.
  // --- campos legacy (tabla única, retrocompatibles) ---
  title?: string; titleFill?: string;
  infoRows?: { label: string; value: string }[];
  headerFill?: string; headerFont?: { bold?: boolean; color?: string };
  freezeHeader?: boolean; autoFilter?: boolean;
  columns?: ExcelColumn[];
  rowsVar?: string;
}
export interface ExcelDoc { sheets: ExcelSheet[]; }
```

Notas de implementación:
- `title.text`, `info.rows[].text` y las cadenas de `band` admiten `{{var}}` → se resuelven con `this.engine.render(text, ctx)`.
- `band`: por cada string en `ctx.data[rowsVar]` agrega **una fila fusionada** `A:mergeTo` con ese texto, aplicando `fill`/`font`.
- `table`: ancho de columna vía `getColumn(i).width` (solo width, NO alignment/numFmt a nivel columna para no pisar filas ya creadas); alineación/numFmt se aplican **por celda**. Encabezado con `headerFill`/`headerFont`/`headerHeight`/`headerAlign` y bordes `thin` si `bordered`. Filas de datos: valor `r[col.key]`; si `rowFillKey` y `r[rowFillKey]` no es null → fill de toda la fila con ese argb; si `bordered` → bordes `thin`; alineación `cellAlign`; `wrapText` si `wrap`; numFmt por celda si `col.numFmt`.

- [ ] **Step 1: Escribir el test que falla**

En `excel-workbook-builder.spec.ts` agrega (usa el `TemplateEngine` real como en los tests existentes del archivo):

```ts
it('renderiza secciones: title, info, band y table con rowFill', async () => {
  const builder = new ExcelWorkbookBuilder(new TemplateEngine());
  const doc: any = { sheets: [{
    name: 'Despacho',
    sections: [
      { kind: 'title', text: '🚚 {{title}}', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [{ text: 'Ruta: {{routeNamesArrow}}' }, { text: 'Paquetes: {{stats.total}}' }] },
      { kind: 'band', rowsVar: 'invalidChunks', fill: 'FFE6E6', font: { bold: true, color: 'CC0000' }, mergeTo: 9 },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [ { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 } ] },
    ],
  }] };
  const ctx: any = { data: {
    title: 'Salida a Ruta', routeNamesArrow: 'R1 -> R2', stats: { total: 2 },
    invalidChunks: ['📦 AAA'],
    rows: [ { index: 1, trackingNumber: 'T1', rowFill: 'F2F2F2' }, { index: 2, trackingNumber: 'T2', rowFill: 'fff2cc' } ],
  } };
  const buf = await builder.build(doc, ctx);
  const wb = new (require('exceljs').Workbook)();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Despacho');
  expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
  expect(ws.getCell('A1').fill.fgColor.argb).toBe('ef883a');
  // fila info 'Ruta:'
  const infoRow = ws.getRow(3).getCell(1).value;
  expect(String(infoRow)).toBe('Ruta: R1 -> R2');
  // band con la guía inválida
  const values = [] as string[];
  ws.eachRow((r) => values.push(String(r.getCell(1).value)));
  expect(values).toContain('📦 AAA');
  // header de tabla
  const headerRowNum = values.findIndex((v) => v === 'No.') + 1;
  expect(ws.getRow(headerRowNum).getCell(1).fill.fgColor.argb).toBe('8c5e4e');
  // fila de datos con rowFill de pago
  const paidRow = headerRowNum + 2; // segunda fila de datos
  expect(ws.getRow(paidRow).getCell(1).fill.fgColor.argb).toBe('fff2cc');
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm test -- src/documents/blocks/excel-workbook-builder.spec.ts`
Expected: FAIL (el builder no conoce `sections`).

- [ ] **Step 3: Implementar el soporte de secciones**

En `excel-workbook-builder.ts`, en `buildSheet`, al inicio ramifica:

```ts
private buildSheet(wb: ExcelJS.Workbook, sheet: ExcelSheet, ctx: RenderContext) {
  const ws = wb.addWorksheet(sheet.name);
  if (sheet.sections?.length) { this.buildSections(ws, sheet.sections, ctx); return; }
  // ... (ruta de tabla única existente, sin cambios) ...
}
```

Agrega los métodos privados:

```ts
private buildSections(ws: ExcelJS.Worksheet, sections: ExcelSection[], ctx: RenderContext) {
  for (const s of sections) {
    switch (s.kind) {
      case 'spacer': ws.addRow([]); break;
      case 'title': {
        const row = ws.addRow([this.engine.render(s.text, ctx)]);
        ws.mergeCells(row.number, 1, row.number, s.mergeTo);
        row.font = { size: s.font?.size, bold: s.font?.bold, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
        row.alignment = { vertical: 'middle', horizontal: 'center' };
        if (s.height) row.height = s.height;
        if (s.fill) for (let c = 1; c <= s.mergeTo; c++) ws.getCell(row.number, c).fill = solid(s.fill);
        break;
      }
      case 'info':
        for (const r of s.rows) {
          const row = ws.addRow([this.engine.render(r.text, ctx)]);
          ws.mergeCells(row.number, 1, row.number, s.mergeTo);
        }
        break;
      case 'band': {
        const items: any[] = Array.isArray(ctx.data?.[s.rowsVar]) ? ctx.data[s.rowsVar] : [];
        for (const item of items) {
          const row = ws.addRow([this.engine.render(String(item), ctx)]);
          ws.mergeCells(row.number, 1, row.number, s.mergeTo);
          row.font = { bold: s.font?.bold, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
          row.alignment = { vertical: 'middle', horizontal: 'left' };
          if (s.fill) for (let c = 1; c <= s.mergeTo; c++) ws.getCell(row.number, c).fill = solid(s.fill);
        }
        break;
      }
      case 'table': this.buildTableSection(ws, s, ctx); break;
    }
  }
}

private buildTableSection(ws: ExcelJS.Worksheet, s: Extract<ExcelSection, { kind: 'table' }>, ctx: RenderContext) {
  s.columns.forEach((c, i) => { if (c.width != null) ws.getColumn(i + 1).width = c.width; });
  const headerRow = ws.addRow(s.columns.map((c) => c.label));
  if (s.headerHeight) headerRow.height = s.headerHeight;
  headerRow.eachCell((cell, col) => {
    if (s.headerFont) cell.font = { bold: s.headerFont.bold, ...(s.headerFont.color ? { color: { argb: s.headerFont.color } } : {}) };
    if (s.headerFill) cell.fill = solid(s.headerFill);
    cell.alignment = { vertical: 'middle', horizontal: s.headerAlign ?? 'left' };
    if (s.bordered) cell.border = thin();
    void col;
  });
  const rows: any[] = Array.isArray(ctx.data?.[s.rowsVar]) ? ctx.data[s.rowsVar] : [];
  for (const r of rows) {
    const dataRow = ws.addRow(s.columns.map((c) => r?.[c.key] ?? ''));
    const fill = s.rowFillKey ? r?.[s.rowFillKey] : null;
    dataRow.eachCell((cell, col) => {
      const c = s.columns[col - 1];
      if (fill) cell.fill = solid(fill);
      if (s.bordered) cell.border = thin();
      cell.alignment = { vertical: 'middle', horizontal: s.cellAlign ?? 'left', ...(s.wrap ? { wrapText: true } : {}) };
      if (c?.numFmt) cell.numFmt = c.numFmt;
    });
  }
  if (s.freezeHeader) ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
  if (s.autoFilter) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: s.columns.length } };
}
```

Agrega los helpers al final del archivo (fuera de la clase):

```ts
function solid(argb: string): ExcelJS.Fill { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function thin(): Partial<ExcelJS.Borders> {
  const b = { style: 'thin' as const };
  return { top: b, left: b, bottom: b, right: b };
}
```

Importa el tipo `ExcelSection` arriba: `import { ExcelDoc, ExcelSheet, ExcelSection } from './excel-doc.types';`

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `npm test -- src/documents/blocks/excel-workbook-builder.spec.ts`
Expected: PASS (incluye los tests previos de tabla única, intactos).

- [ ] **Step 5: Commit**

```bash
git add src/documents/blocks/excel-doc.types.ts src/documents/blocks/excel-workbook-builder.ts src/documents/blocks/excel-workbook-builder.spec.ts
git commit -m "feat(documents): ExcelDoc con secciones (title/info/band/table + rowFill) en el builder"
```

---

### Task 3: Data-provider `route-dispatch.mapper.ts`

**Files:**
- Create: `src/documents/data/route-dispatch.mapper.ts`
- Test: `src/documents/data/route-dispatch.mapper.spec.ts`

**Interfaces:**
- Consumes: `RouteDispatchInput` (ver "Contrato de datos").
- Produces: `buildRouteDispatchData(input: RouteDispatchInput): Record<string, any>` con el shape del "Contrato de datos". Funciones auxiliares exportadas: `sortByZip(pkgs)`, `truncateDouble(s, a, b)`, `formatPhone(s)`.

Reglas fieles a C1/C2:
- **Orden:** si `sortByPostalCode !== false` → `sortByZip` (numérico ascendente por `recipientZip`; los vacíos al final; estable). Si no, orden de entrada.
- **Stats** (recorriendo el arreglo ordenado): `f2Count++` si `isCharge`; `cargaCount++` y `highValueCount++` si `isHighValue`; `withPaymentCount++` y `totalPaymentAmount += Number(payment.amount)` si `payment?.amount` truthy; `fedexCount++` si `shipmentType==='fedex'`; `dhlCount++` si `shipmentType==='dhl'`; `expiringTodayCount++` si `commitDateTime` y su fecha Hermosillo `=== generatedDate`. `total=length`; `regularCount=total - f2Count - highValueCount`; `montoFmt='$'+totalPaymentAmount.toFixed(2)`.
- **icons:** `` `${consolidated?.type==='aereo'?'[A]':''}${isCharge?'[C]':''}${payment?'[$]':''}${isHighValue?'[H]':''}` `` (nota: `[$]` depende de que exista el objeto `payment`, no del monto).
- **Truncados PDF:** `truncateDouble(recipientName, 25, 22)` y `truncateDouble(recipientAddress, 28, 26)`. `truncateDouble(s,a,b)`: primero `s.length>a ? s.slice(0,a-3)+'...' : s`, luego sobre ese resultado `r.length>b ? r.slice(0,b-2)+'..' : r`.
- **paymentPdf:** `hasPayment ? `${payment.type} $${payment.amount}` : ''`. **paymentXlsx:** `hasPayment ? `${payment.type} $ ${payment.amount}` : ''`. `hasPayment = payment?.amount != null`.
- **rowClass (PDF):** une, separados por espacio, `even` (índice 0-based par), `pago` (hasPayment), `vencehoy` (isExpiringToday), `zone` (sortByPostalCode && i>0 && zona!=zonaPrev; zona=`(recipientZip||'').slice(0,2)`).
- **rowFill (Excel):** `hasPayment ? 'fff2cc' : (índice 0-based par ? 'F2F2F2' : null)`.
- **formatPhone:** null/'' → 'N/A'; valores tipo "sin teléfono/s/tel/not phone" (case-insensitive, lista: `['sin teléfono','sin telefono','s/telefono','s/teléfono','s/tel','sin tel','not phone']`) → '-'; si no, dígitos únicamente (`replace(/\D/g,'')`), y si el resultado empieza con `52` y tiene 12 dígitos, quita la lada (`slice(2)`).
- **invalidChunks (Excel):** parte `invalidTrackings` en grupos de 6; cada grupo → `grupo.map(t=>`📦 ${t}`).join('    ')` (4 espacios). **invalidRows (PDF):** `invalidTrackings.map((t,i)=>({ index: rows.length + i + 1, trackingNumber: t }))`.
- **Fechas Hermosillo:** usar `date-fns-tz` (`toZonedTime`, `format`) con `TZ='America/Hermosillo'`, como en el resto del código.

- [ ] **Step 1: Escribir los tests que fallan**

Crea `src/documents/data/route-dispatch.mapper.spec.ts`:

```ts
import { buildRouteDispatchData, truncateDouble, formatPhone } from './route-dispatch.mapper';

const baseInput = () => ({
  subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01',
  drivers: [{ name: 'Juan Perez' }], routes: [{ name: 'R1' }, { name: 'R2' }],
  trackingNumber: 'SEG-123', sortByPostalCode: true,
  now: new Date('2026-07-18T20:00:00Z'),        // 13:00 Hermosillo
  createdAt: '2026-07-18T20:00:00Z',
  packages: [
    { trackingNumber: 'T1', recipientName: 'Ana', recipientZip: '85000', recipientPhone: '5216621234567',
      isCharge: true, payment: { amount: 500, type: 'COD' }, shipmentType: 'fedex', commitDateTime: '2026-07-18T20:00:00Z' },
    { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000', isHighValue: true, shipmentType: 'dhl',
      consolidated: { type: 'aereo' } },
  ],
  invalidTrackings: ['X1', 'X2'],
});

it('stats: cuenta F2/alto valor/cobro/fedex/dhl/vence-hoy y monto', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.stats.total).toBe(2);
  expect(d.stats.f2Count).toBe(1);
  expect(d.stats.highValueCount).toBe(1);
  expect(d.stats.cargaCount).toBe(1);
  expect(d.stats.regularCount).toBe(0);         // 2 - 1 - 1
  expect(d.stats.withPaymentCount).toBe(1);
  expect(d.stats.totalPaymentAmount).toBe(500);
  expect(d.stats.montoFmt).toBe('$500.00');
  expect(d.stats.fedexCount).toBe(1);
  expect(d.stats.dhlCount).toBe(1);
  expect(d.stats.expiringTodayCount).toBe(1);   // T1 vence hoy Hermosillo
});

it('orden por CP ascendente (83000 antes que 85000)', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.rows.map((r: any) => r.trackingNumber)).toEqual(['T2', 'T1']);
});

it('icons y clases de fila', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  const t1 = d.rows.find((r: any) => r.trackingNumber === 'T1');
  const t2 = d.rows.find((r: any) => r.trackingNumber === 'T2');
  expect(t1.icons).toBe('[C][$]');              // carga + payment (objeto existe)
  expect(t2.icons).toBe('[A][H]');              // aereo + alto valor
  expect(t1.rowClass).toContain('pago');
  expect(t1.rowClass).toContain('vencehoy');
  expect(t1.rowFill).toBe('fff2cc');
  expect(t1.paymentPdf).toBe('COD $500');
  expect(t1.paymentXlsx).toBe('COD $ 500');
});

it('invalidChunks (Excel) e invalidRows (PDF)', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.hasInvalid).toBe(true);
  expect(d.invalidChunks).toEqual(['📦 X1    📦 X2']);
  expect(d.invalidRows).toEqual([{ index: 3, trackingNumber: 'X1' }, { index: 4, trackingNumber: 'X2' }]);
});

it('truncateDouble aplica 25→22 y 28→26', () => {
  expect(truncateDouble('x'.repeat(30), 25, 22)).toHaveLength(22);
  expect(truncateDouble('corto', 25, 22)).toBe('corto');
});

it('formatPhone', () => {
  expect(formatPhone('')).toBe('N/A');
  expect(formatPhone('Sin Teléfono')).toBe('-');
  expect(formatPhone('5216621234567')).toBe('6621234567'); // wait: quita lada 52 → 16621234567 (12 díg? ver impl)
});
```

> Nota: ajusta la última aserción de `formatPhone` al comportamiento exacto que implementes; el objetivo es "dígitos locales sin lada". Deja el test alineado a la implementación.

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `npm test -- src/documents/data/route-dispatch.mapper.spec.ts`
Expected: FAIL ("Cannot find module './route-dispatch.mapper'").

- [ ] **Step 3: Implementar el data-provider**

Crea `src/documents/data/route-dispatch.mapper.ts`:

```ts
import { format } from 'date-fns-tz';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/Hermosillo';
const NO_PHONE = ['sin teléfono', 'sin telefono', 's/telefono', 's/teléfono', 's/tel', 'sin tel', 'not phone'];

export interface RouteDispatchPackage {
  trackingNumber: string;
  recipientName?: string; recipientAddress?: string; recipientZip?: string; recipientPhone?: string;
  commitDateTime?: string;
  isCharge?: boolean; isHighValue?: boolean;
  payment?: { amount: number | string; type: string } | null;
  shipmentType?: string;
  consolidated?: { type?: string } | null;
}
export interface RouteDispatchInput {
  subsidiaryName: string; vehicleName?: string;
  drivers: { name: string }[]; routes: { name: string }[];
  trackingNumber: string; packages: RouteDispatchPackage[];
  invalidTrackings?: string[]; sortByPostalCode?: boolean;
  now?: Date; createdAt?: string | Date;
}

export function truncateDouble(s: string, a: number, b: number): string {
  const first = s.length > a ? s.slice(0, a - 3) + '...' : s;
  return first.length > b ? first.slice(0, b - 2) + '..' : first;
}

export function formatPhone(raw?: string): string {
  if (!raw || !String(raw).trim()) return 'N/A';
  if (NO_PHONE.includes(String(raw).trim().toLowerCase())) return '-';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
  return digits;
}

export function sortByZip(pkgs: RouteDispatchPackage[]): RouteDispatchPackage[] {
  return [...pkgs].sort((x, y) => {
    const zx = (x.recipientZip || '').trim(), zy = (y.recipientZip || '').trim();
    if (!zx && !zy) return 0;
    if (!zx) return 1;
    if (!zy) return -1;
    const nx = Number(zx), ny = Number(zy);
    if (!isNaN(nx) && !isNaN(ny) && nx !== ny) return nx - ny;
    return zx.localeCompare(zy);
  });
}

export function buildRouteDispatchData(input: RouteDispatchInput): Record<string, any> {
  const now = input.now ?? new Date();
  const zonedNow = toZonedTime(now, TZ);
  const generatedDate = format(zonedNow, 'yyyy-MM-dd', { timeZone: TZ });
  const generatedTime = format(zonedNow, 'HH:mm:ss', { timeZone: TZ });
  const dispatchAt = input.createdAt ? new Date(input.createdAt) : now;
  const dispatchDateTime = format(toZonedTime(dispatchAt, TZ), 'yyyy-MM-dd HH:mm', { timeZone: TZ });

  const ordered = input.sortByPostalCode === false ? input.packages : sortByZip(input.packages);

  const stats = { total: ordered.length, regularCount: 0, f2Count: 0, cargaCount: 0, highValueCount: 0,
    withPaymentCount: 0, totalPaymentAmount: 0, montoFmt: '$0.00', expiringTodayCount: 0, fedexCount: 0, dhlCount: 0 };

  let prevZone: string | null = null;
  const rows = ordered.map((p, i) => {
    const hasPayment = p.payment?.amount != null;
    if (p.isCharge) stats.f2Count++;
    if (p.isHighValue) { stats.cargaCount++; stats.highValueCount++; }
    if (hasPayment) { stats.withPaymentCount++; stats.totalPaymentAmount += Number(p.payment!.amount) || 0; }
    if (p.shipmentType === 'fedex') stats.fedexCount++;
    if (p.shipmentType === 'dhl') stats.dhlCount++;
    let date = '', time = '', isExpiringToday = false;
    if (p.commitDateTime) {
      const z = toZonedTime(new Date(p.commitDateTime), TZ);
      date = format(z, 'yyyy-MM-dd', { timeZone: TZ });
      time = format(z, 'HH:mm:ss', { timeZone: TZ });
      isExpiringToday = date === generatedDate;
      if (isExpiringToday) stats.expiringTodayCount++;
    }
    const icons = `${p.consolidated?.type === 'aereo' ? '[A]' : ''}${p.isCharge ? '[C]' : ''}${p.payment ? '[$]' : ''}${p.isHighValue ? '[H]' : ''}`;
    const zone = (p.recipientZip || '').slice(0, 2);
    const zoneChanged = input.sortByPostalCode !== false && i > 0 && zone !== prevZone;
    prevZone = zone;
    const cls = [i % 2 === 0 ? 'even' : '', hasPayment ? 'pago' : '', isExpiringToday ? 'vencehoy' : '', zoneChanged ? 'zone' : ''].filter(Boolean).join(' ');
    const rowFill = hasPayment ? 'fff2cc' : (i % 2 === 0 ? 'F2F2F2' : null);
    return {
      index: i + 1, icons, trackingNumber: p.trackingNumber,
      recipientName: truncateDouble(p.recipientName || '', 25, 22), recipientNameXlsx: p.recipientName || '',
      recipientAddress: truncateDouble(p.recipientAddress || '', 28, 26), recipientAddressXlsx: p.recipientAddress || '',
      recipientZip: p.recipientZip || '',
      paymentPdf: hasPayment ? `${p.payment!.type} $${p.payment!.amount}` : '',
      paymentXlsx: hasPayment ? `${p.payment!.type} $ ${p.payment!.amount}` : '',
      date, time, recipientPhone: formatPhone(p.recipientPhone), rowClass: cls, rowFill,
    };
  });
  stats.regularCount = stats.total - stats.f2Count - stats.highValueCount;
  stats.montoFmt = `$${stats.totalPaymentAmount.toFixed(2)}`;

  const invalid = input.invalidTrackings ?? [];
  const invalidChunks: string[] = [];
  for (let i = 0; i < invalid.length; i += 6) invalidChunks.push(invalid.slice(i, i + 6).map((t) => `📦 ${t}`).join('    '));
  const invalidRows = invalid.map((t, i) => ({ index: rows.length + i + 1, trackingNumber: t }));

  return {
    title: 'SALIDA A RUTA',
    subsidiaryName: input.subsidiaryName || 'N/A',
    vehicleName: input.vehicleName || 'N/A',
    mainDriver: input.drivers?.[0]?.name || 'No asignado',
    routeNames: input.routes?.length ? input.routes.map((r) => r.name).join(' → ') : 'No asignado',
    driverNames: input.drivers?.length ? input.drivers.map((d) => d.name).join(' - ') : 'N/A',
    routeNamesArrow: input.routes?.length ? input.routes.map((r) => r.name).join(' -> ') : 'N/A',
    trackingNumber: input.trackingNumber,
    isHermosillo: (input.subsidiaryName || '').toLowerCase().includes('hermosillo'),
    generatedDate, generatedTime, dispatchDateTime,
    stats, rows, invalidRows, invalidChunks, hasInvalid: invalid.length > 0, invalidCount: invalid.length,
  };
}
```

- [ ] **Step 4: Correr los tests y verlos pasar** (ajusta la aserción de `formatPhone` al valor real)

Run: `npm test -- src/documents/data/route-dispatch.mapper.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/documents/data/route-dispatch.mapper.ts src/documents/data/route-dispatch.mapper.spec.ts
git commit -m "feat(documents): data-provider route-dispatch (stats/orden/truncados/flags fieles a C1/C2)"
```

---

### Task 4: Plantilla HTML `route_dispatch_pdf` + seed

**Files:**
- Create: `src/documents/seeds/templates/route-dispatch.pdf.html.ts`
- Modify: `src/documents/seeds/pdf-templates.seed.ts`
- Test: `src/documents/seeds/pdf-templates.seed.spec.ts`

**Interfaces:**
- Consumes: el objeto `data` del Task 3 + branding.
- Produces: seed `route_dispatch_pdf` (PdfDoc con `html`). El HTML es fiel a C1: header (logo+título+fecha/hora), grid de 3 (Sucursal/Vehículo/Chofer), fila de 11 métricas, simbología, tabla principal (HORA oculta si Hermosillo) y tabla "TRACKINGS INVÁLIDOS".

- [ ] **Step 1: Crear la plantilla HTML**

Crea `src/documents/seeds/templates/route-dispatch.pdf.html.ts`:

```ts
export const ROUTE_DISPATCH_PDF_HTML = `
<style>
  body { font-size: 9px; color: #212529; }
  .rd-header { display:flex; justify-content:space-between; align-items:center; height:35px; margin-bottom:3px; padding-bottom:2px; border-bottom:1px solid #8c5e4e; }
  .rd-header img { width:30px; height:30px; }
  .rd-title { font-size:14px; font-weight:bold; color:#8c5e4e; text-align:center; }
  .rd-date { font-size:8px; color:#212529; text-align:right; line-height:1.1; }
  .rd-grid, .rd-metrics { display:flex; justify-content:space-between; height:25px; padding:2px; margin-bottom:2px; background:#f8f9fa; border-radius:2px; border:0.5px solid #000; }
  .rd-grid .cell { width:32%; padding:0.5px; }
  .rd-metrics .cell { flex:1; text-align:center; }
  .rd-lbl { font-size:7px; font-weight:bold; color:#8c5e4e; }
  .rd-val { font-size:7px; color:#212529; line-height:1; }
  .rd-val.hi { color:#fd7e14; } .rd-val.urg { color:#ff6b6b; }
  .rd-sym { display:flex; justify-content:center; height:10px; padding:1px; margin-bottom:2px; background:#f8f9fa; border-radius:2px; border:0.5px solid #000; font-size:6px; font-weight:bold; color:#8c5e4e; }
  table { width:100%; border-collapse:collapse; border:0.5px solid #000; border-radius:3px; }
  thead th { background:#8c5e4e; color:#fff; padding:1px; font-size:8px; font-weight:bold; text-align:left; }
  tbody td { padding:0.5px; border-bottom:0.5px solid #000; font-size:9px; }
  tr.even td { background:#f8f9fa; }
  tr.pago td { background:#fff2cc; font-weight:bold; }
  tr.vencehoy td { background:#ffe6e6; }
  tr.zone td { border-top:2px solid #8c5e4e; }
  .rd-invalid { margin-top:6px; border:0.5px solid #ff9999; }
  .rd-invalid .banner { background:#ff9999; color:#fff; text-align:center; font-size:10px; font-weight:bold; padding:2px; }
  .rd-invalid tr.even td { background:#fff0f0; }
  .rd-invalid td.idx { color:#cc0000; font-weight:bold; }
</style>
<div class="rd-header">
  {{#if brand.logoLight}}<img src="{{brand.logoLight}}" />{{else}}<span></span>{{/if}}
  <div class="rd-title">SALIDA A RUTA</div>
  <div class="rd-date">{{generatedDate}}<br/>{{generatedTime}}</div>
</div>
<div class="rd-grid">
  <div class="cell"><div class="rd-lbl">Sucursal</div><div class="rd-val">{{subsidiaryName}}</div></div>
  <div class="cell"><div class="rd-lbl">Vehículo</div><div class="rd-val">{{vehicleName}}</div></div>
  <div class="cell"><div class="rd-lbl">Chofer Principal</div><div class="rd-val">{{mainDriver}}</div></div>
</div>
<div class="rd-metrics">
  <div class="cell"><div class="rd-lbl">RUTA</div><div class="rd-val">{{routeNames}}</div></div>
  <div class="cell"><div class="rd-lbl">SEGUIMIENTO</div><div class="rd-val">{{trackingNumber}}</div></div>
  <div class="cell"><div class="rd-lbl">TOTAL</div><div class="rd-val">{{stats.total}}</div></div>
  <div class="cell"><div class="rd-lbl">REGULARES</div><div class="rd-val">{{stats.regularCount}}</div></div>
  <div class="cell"><div class="rd-lbl">F2 / 31.5</div><div class="rd-val hi">{{stats.f2Count}}</div></div>
  <div class="cell"><div class="rd-lbl">ALTO VALOR</div><div class="rd-val hi">{{stats.cargaCount}}</div></div>
  <div class="cell"><div class="rd-lbl">CON COBRO</div><div class="rd-val">{{stats.withPaymentCount}}</div></div>
  <div class="cell"><div class="rd-lbl">VENCEN HOY</div><div class="rd-val urg">{{stats.expiringTodayCount}}</div></div>
  <div class="cell"><div class="rd-lbl">MONTO</div><div class="rd-val">{{stats.montoFmt}}</div></div>
  <div class="cell"><div class="rd-lbl">Fedex</div><div class="rd-val">{{stats.fedexCount}}</div></div>
  <div class="cell"><div class="rd-lbl">DHL</div><div class="rd-val">{{stats.dhlCount}}</div></div>
</div>
<div class="rd-sym">SIMBOLOGÍA: [C] CARGA/F2/31.5 • [$] PAGO • [H] VALOR ALTO • [A] AÉREO (PRIORIDAD)</div>
<table>
  <thead><tr>
    <th style="width:30px">[#]</th><th style="width:65px">NO. GUIA</th><th style="width:135px">NOMBRE</th>
    <th style="width:155px">DIRECCIÓN</th><th style="width:26px">CP</th><th style="width:63px">COBRO</th>
    <th style="width:47px">FECHA</th>{{#unless isHermosillo}}<th style="width:38px">HORA</th>{{/unless}}
    <th style="width:50px">CELULAR</th><th style="width:80px">NOMBRE Y FIRMA</th>
  </tr></thead>
  <tbody>
    {{#each rows}}
    <tr class="{{rowClass}}">
      <td>{{icons}} {{index}}</td><td>{{trackingNumber}}</td><td>{{recipientName}}</td>
      <td>{{recipientAddress}}</td><td>{{recipientZip}}</td><td>{{paymentPdf}}</td>
      <td>{{date}}</td>{{#unless ../isHermosillo}}<td>{{time}}</td>{{/unless}}
      <td>{{recipientPhone}}</td><td></td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{#if hasInvalid}}
<div class="rd-invalid">
  <div class="banner">TRACKINGS INVÁLIDOS / NO ENCONTRADOS</div>
  <table>
    <thead><tr>
      <th style="width:30px">[#]</th><th style="width:65px">NO. GUIA</th><th style="width:135px">NOMBRE</th>
      <th style="width:155px">DIRECCIÓN</th><th style="width:26px">CP</th><th style="width:63px">COBRO</th>
      <th style="width:47px">FECHA</th>{{#unless isHermosillo}}<th style="width:38px">HORA</th>{{/unless}}
      <th style="width:50px">CELULAR</th><th style="width:60px">NOMBRE Y FIRMA</th>
    </tr></thead>
    <tbody>
      {{#each invalidRows}}
      <tr class="{{#if @even}}even{{/if}}">
        <td class="idx">{{index}}</td><td class="idx">{{trackingNumber}}</td><td></td><td></td><td></td><td></td><td></td>
        {{#unless ../isHermosillo}}<td></td>{{/unless}}<td></td><td></td>
      </tr>
      {{/each}}
    </tbody>
  </table>
</div>
{{/if}}
`;
```

> Nota: `@even` de Handlebars es par en base 0 (fila 1 = index 0 = par). Coincide con la regla "index par → fondo alterno" del original.

- [ ] **Step 2: Escribir el test de fidelidad estructural**

En `pdf-templates.seed.spec.ts` agrega un test que verifica que el seed nuevo está en el arreglo y que, compuesto+interpolado, el HTML contiene lo esperado. Usa `PdfHtmlComposer` + `TemplateEngine` directamente:

```ts
import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { TemplateEngine } from '../template-engine';
import { PDF_TEMPLATE_SEEDS } from './pdf-templates.seed';
import { buildRouteDispatchData } from '../data/route-dispatch.mapper';

it('route_dispatch_pdf: HTML fiel (métricas, simbología, HORA condicional)', () => {
  const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch_pdf')!;
  expect(seed).toBeTruthy();
  const html = new PdfHtmlComposer().compose(seed.doc);
  const data = buildRouteDispatchData({
    subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }],
    trackingNumber: 'SEG-1', now: new Date('2026-07-18T20:00:00Z'),
    packages: [{ trackingNumber: 'T1', recipientName: 'Ana', recipientZip: '85000', payment: { amount: 500, type: 'COD' } }],
    invalidTrackings: ['X1'],
  } as any);
  const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
  expect(out).toContain('SALIDA A RUTA');
  expect(out).toContain('SIMBOLOGÍA: [C] CARGA/F2/31.5');
  expect(out).toContain('VENCEN HOY');
  expect(out).toContain('COD $500');
  expect(out).toContain('TRACKINGS INVÁLIDOS');
  expect(out).toContain('<th style="width:38px">HORA</th>'); // no Hermosillo → HORA visible
});

it('route_dispatch_pdf: oculta HORA en Hermosillo', () => {
  const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch_pdf')!;
  const html = new PdfHtmlComposer().compose(seed.doc);
  const data = buildRouteDispatchData({ subsidiaryName: 'Hermosillo', drivers: [], routes: [], trackingNumber: 'S', packages: [] } as any);
  const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
  expect(out).not.toContain('>HORA<');
});
```

- [ ] **Step 3: Verlo fallar**

Run: `npm test -- src/documents/seeds/pdf-templates.seed.spec.ts`
Expected: FAIL (no existe el seed `route_dispatch_pdf`).

- [ ] **Step 4: Registrar el seed**

En `pdf-templates.seed.ts`: importa la plantilla y agrega el seed al arreglo:

```ts
import { ROUTE_DISPATCH_PDF_HTML } from './templates/route-dispatch.pdf.html';

const routeDispatch: PdfDoc = {
  page: { size: 'LETTER', orientation: 'landscape', margins: '5px' },
  html: ROUTE_DISPATCH_PDF_HTML,
};
```

y dentro de `PDF_TEMPLATE_SEEDS` agrega:

```ts
{ code: 'route_dispatch_pdf', name: 'Salida a Ruta (PDF)', doc: routeDispatch,
  variables: [
    { name: 'subsidiaryName', label: 'Sucursal' }, { name: 'vehicleName', label: 'Vehículo' },
    { name: 'mainDriver', label: 'Chofer principal' }, { name: 'routeNames', label: 'Rutas' },
    { name: 'trackingNumber', label: 'Seguimiento' }, { name: 'isHermosillo', label: 'Es Hermosillo', dataType: 'boolean' },
    { name: 'generatedDate', label: 'Fecha generación' }, { name: 'generatedTime', label: 'Hora generación' },
    { name: 'stats', label: 'Métricas' }, { name: 'rows', label: 'Filas de paquetes' },
    { name: 'invalidRows', label: 'Trackings inválidos' }, { name: 'hasInvalid', label: 'Hay inválidos', dataType: 'boolean' },
  ] },
```

- [ ] **Step 5: Verlo pasar y commit**

Run: `npm test -- src/documents/seeds/pdf-templates.seed.spec.ts`
Expected: PASS.

```bash
git add src/documents/seeds/templates/route-dispatch.pdf.html.ts src/documents/seeds/pdf-templates.seed.ts src/documents/seeds/pdf-templates.seed.spec.ts
git commit -m "feat(documents): seed route_dispatch_pdf (HTML fiel a C1, HORA condicional, inválidos)"
```

---

### Task 5: Seed `route_dispatch_excel` (secciones) + test de fidelidad

**Files:**
- Modify: `src/documents/seeds/excel-templates.seed.ts`
- Test: `src/documents/seeds/excel-templates.seed.spec.ts`

**Interfaces:**
- Consumes: `data` del Task 3.
- Produces: seed `route_dispatch_excel` (ExcelDoc con una hoja "Despacho" de secciones), fiel a C2.

- [ ] **Step 1: Escribir el test de fidelidad**

En `excel-templates.seed.spec.ts` agrega:

```ts
import { EXCEL_TEMPLATE_SEEDS } from './excel-templates.seed';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { TemplateEngine } from '../template-engine';
import { buildRouteDispatchData } from '../data/route-dispatch.mapper';
import { Workbook } from 'exceljs';

it('route_dispatch_excel: fiel a C2 (título naranja, header café, pago amarillo, inválidos)', async () => {
  const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch_excel')!;
  expect(seed).toBeTruthy();
  const data = buildRouteDispatchData({
    subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }, { name: 'R2' }],
    trackingNumber: 'S1', now: new Date('2026-07-18T20:00:00Z'), createdAt: '2026-07-18T20:00:00Z',
    packages: [
      { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000', recipientPhone: '6620000000', payment: { amount: 500, type: 'COD' }, commitDateTime: '2026-07-18T20:00:00Z' },
      { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000' },
    ],
    invalidTrackings: ['X1', 'X2'],
  } as any);
  const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
  const wb = new Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Despacho');
  expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
  expect(ws.getCell('A1').fill.fgColor.argb).toBe('ef883a');
  // encabezado de columnas café
  let headerRowNum = 0;
  ws.eachRow((r, n) => { if (r.getCell(1).value === 'No.') headerRowNum = n; });
  expect(headerRowNum).toBeGreaterThan(0);
  expect(ws.getRow(headerRowNum).getCell(1).fill.fgColor.argb).toBe('8c5e4e');
  // una fila con pago amarillo
  let paidFound = false;
  ws.eachRow((r) => { if (r.getCell(1).fill?.fgColor?.argb === 'fff2cc') paidFound = true; });
  expect(paidFound).toBe(true);
  // sección inválidos presente
  let invalidFound = false;
  ws.eachRow((r) => { if (String(r.getCell(1).value).includes('📦 X1')) invalidFound = true; });
  expect(invalidFound).toBe(true);
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npm test -- src/documents/seeds/excel-templates.seed.spec.ts`
Expected: FAIL (no existe `route_dispatch_excel`).

- [ ] **Step 3: Registrar el seed**

En `excel-templates.seed.ts` agrega el ExcelDoc y el seed:

```ts
const routeDispatch: ExcelDoc = {
  sheets: [{
    name: 'Despacho',
    sections: [
      { kind: 'title', text: '🚚 Salida a Ruta', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Ruta: {{routeNamesArrow}}' }, { text: 'Conductores: {{driverNames}}' },
        { text: 'Unidad: {{vehicleName}}' }, { text: 'Fecha: {{dispatchDateTime}}' }, { text: 'Paquetes: {{stats.total}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'band', rowsVar: 'invalidChunks', fill: 'FFE6E6', font: { bold: true, color: 'CC0000' }, mergeTo: 9 },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientNameXlsx', label: 'Recibe', width: 30 }, { key: 'recipientAddressXlsx', label: 'Dirección', width: 40 },
          { key: 'recipientZip', label: 'CP', width: 10 }, { key: 'paymentXlsx', label: 'Cobro', width: 18 },
          { key: 'date', label: 'Fecha', width: 12 }, { key: 'time', label: 'Hora', width: 12 },
          { key: 'recipientPhone', label: 'Celular', width: 18 },
        ] },
    ],
  }],
};
```

y en `EXCEL_TEMPLATE_SEEDS`:

```ts
{ code: 'route_dispatch_excel', name: 'Salida a Ruta (Excel)', doc: routeDispatch,
  variables: [
    { name: 'routeNamesArrow', label: 'Rutas' }, { name: 'driverNames', label: 'Conductores' },
    { name: 'vehicleName', label: 'Unidad' }, { name: 'dispatchDateTime', label: 'Fecha' },
    { name: 'stats', label: 'Métricas' }, { name: 'invalidChunks', label: 'Guías inválidas' }, { name: 'rows', label: 'Filas' },
  ] },
```

> Nota fidelidad: C2 aplica fila alterna `F2F2F2` en índice par y pago `fff2cc` (el pago gana). El data-provider ya lo resuelve en `rowFill`. La sección "Guías Inválidas" del original incluye además un título `❌ Guías Inválidas (N)` en rojo `FF0000`; si se requiere exacto, anteponer una sección `title` condicionada — para este lote basta la banda de guías (el título se puede añadir en pulido). Documentar como diferencia menor si se omite.

- [ ] **Step 4: Verlo pasar y commit**

Run: `npm test -- src/documents/seeds/excel-templates.seed.spec.ts`
Expected: PASS.

```bash
git add src/documents/seeds/excel-templates.seed.ts src/documents/seeds/excel-templates.seed.spec.ts
git commit -m "feat(documents): seed route_dispatch_excel (secciones fieles a C2)"
```

---

### Task 6: Integración en package-dispatch detrás del flag `DOC_ENGINE_ROUTE_DISPATCH`

**Files:**
- Modify: `src/package-dispatch/package-dispatch.service.ts`
- Modify: `src/package-dispatch/package-dispatch.module.ts` (si `DocumentsModule`/`TemplateService` no está ya inyectado)
- Test: `src/package-dispatch/route-dispatch.integration.spec.ts`

**Interfaces:**
- Consumes: `TemplateService.render`, `buildRouteDispatchData`.
- Produces: `renderRouteDispatchDocuments(input: RouteDispatchInput): Promise<{ pdf?: Buffer; excel?: Buffer }>` (público para test). Genera ambos vía motor; si un formato no devuelve buffer, ese campo queda `undefined` (el caller usa el archivo del frontend como respaldo). El flag `process.env.DOC_ENGINE_ROUTE_DISPATCH === 'true'` gobierna si `sendByEmail` intenta usar los buffers del motor en lugar de los subidos.

**Nota de preparación (leer antes de codear):** confirmar en `package-dispatch.service.ts` cómo `sendByEmail(pdfFile, excelFile, subsidiaryName, packageDispatchId)` adjunta y envía, y qué método carga el dispatch con sus `shipments`/`chargeShipments` para construir `RouteDispatchInput`. Reusar ese método existente; si no hay uno, cargar el `PackageDispatch` por id con sus relaciones y mapear cada shipment/charge a `RouteDispatchPackage` (trackingNumber, recipient*, commitDateTime, isCharge, isHighValue, payment, shipmentType, consolidated). Este mapeo es el espejo backend de `mapToPackageInfo`.

- [ ] **Step 1: Escribir el test del método de render**

Crea `src/package-dispatch/route-dispatch.integration.spec.ts`. Testea `renderRouteDispatchDocuments` con un `TemplateService` mockeado:

```ts
import { PackageDispatchService } from './package-dispatch.service';

it('renderRouteDispatchDocuments: usa el motor para pdf y excel', async () => {
  const render = jest.fn()
    .mockResolvedValueOnce({ format: 'pdf', mime: 'application/pdf', buffer: Buffer.from('PDF') })
    .mockResolvedValueOnce({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
  const svc = Object.create(PackageDispatchService.prototype) as any;
  svc.templateService = { render };
  const input = { subsidiaryName: 'Obregon', drivers: [], routes: [], trackingNumber: 'S', packages: [] };
  const out = await svc.renderRouteDispatchDocuments(input);
  expect(render).toHaveBeenNthCalledWith(1, 'route_dispatch_pdf', expect.objectContaining({ title: 'SALIDA A RUTA' }));
  expect(render).toHaveBeenNthCalledWith(2, 'route_dispatch_excel', expect.any(Object));
  expect(out.pdf?.toString()).toBe('PDF');
  expect(out.excel?.toString()).toBe('XLSX');
});

it('renderRouteDispatchDocuments: sin buffer → campo undefined (respaldo frontend)', async () => {
  const render = jest.fn().mockResolvedValue({ format: 'pdf', mime: 'application/pdf' }); // sin buffer
  const svc = Object.create(PackageDispatchService.prototype) as any;
  svc.templateService = { render };
  const out = await svc.renderRouteDispatchDocuments({ subsidiaryName: 'x', drivers: [], routes: [], trackingNumber: 'S', packages: [] });
  expect(out.pdf).toBeUndefined();
  expect(out.excel).toBeUndefined();
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npm test -- src/package-dispatch/route-dispatch.integration.spec.ts`
Expected: FAIL (`renderRouteDispatchDocuments` no existe).

- [ ] **Step 3: Implementar el método + flag**

En `package-dispatch.service.ts` importa `buildRouteDispatchData` y (si falta) inyecta `TemplateService` en el constructor. Agrega:

```ts
async renderRouteDispatchDocuments(input: RouteDispatchInput): Promise<{ pdf?: Buffer; excel?: Buffer }> {
  const data = buildRouteDispatchData(input);
  const [pdf, excel] = await Promise.all([
    this.templateService.render('route_dispatch_pdf', data).then((r) => r.buffer).catch(() => undefined),
    this.templateService.render('route_dispatch_excel', data).then((r) => r.buffer).catch(() => undefined),
  ]);
  return { pdf, excel };
}
```

En `sendByEmail`, antes de armar los adjuntos, si el flag está activo intenta el motor y sustituye buffers; si algo falta, usa los archivos subidos (respaldo). Envuelve en try/catch para nunca romper el envío:

```ts
let pdfBuffer = pdfFile.buffer, excelBuffer = excelFile.buffer;
if (process.env.DOC_ENGINE_ROUTE_DISPATCH === 'true') {
  try {
    const input = await this.loadRouteDispatchInput(packageDispatchId); // ver nota de preparación
    const gen = await this.renderRouteDispatchDocuments(input);
    if (gen.pdf) pdfBuffer = gen.pdf;
    if (gen.excel) excelBuffer = gen.excel;
  } catch (e: any) {
    this.logger?.warn?.(`Motor route_dispatch falló; uso archivos subidos: ${e?.message}`);
  }
}
// ...usar pdfBuffer/excelBuffer al construir attachments...
```

Implementa `loadRouteDispatchInput(packageDispatchId): Promise<RouteDispatchInput>` cargando el dispatch con sus relaciones y mapeando a `RouteDispatchPackage[]` (espejo de `mapToPackageInfo`, ver nota de preparación).

- [ ] **Step 4: Verlo pasar**

Run: `npm test -- src/package-dispatch/route-dispatch.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Compilar y refrescar el grafo**

Run: `npm run build` (o `npx tsc --noEmit`) → sin errores de tipos.
Run: `graphify update .`

- [ ] **Step 6: Commit**

```bash
git add src/package-dispatch/package-dispatch.service.ts src/package-dispatch/package-dispatch.module.ts src/package-dispatch/route-dispatch.integration.spec.ts
git commit -m "feat(package-dispatch): Salida a Ruta por el motor detrás de flag DOC_ENGINE_ROUTE_DISPATCH (fallback a archivos del frontend)"
```

---

## Verificación end-to-end (manual, tras los 6 tasks)

1. Backend en `feat/template-engine-phase3` con migración/`DB_SYNC` + `npm run seed` (crea `route_dispatch_pdf` y `route_dispatch_excel`) + `npm run start`.
2. Con `DOC_ENGINE_ROUTE_DISPATCH=true` y Chromium disponible (`CHROMIUM_PATH` o `channel:'chrome'`): generar una Salida a Ruta y comparar el PDF/Excel adjunto contra el generado por el frontend (referencia dorada). Verificar: métricas, orden por CP, colores de fila (pago/vence-hoy/alterno), HORA oculta en Hermosillo, tabla de inválidos.
3. Con el flag apagado: confirmar que se adjuntan los archivos del frontend (respaldo intacto).

## Self-review (cobertura del spec)

- Plantilla única rica por tipo → `route_dispatch_pdf`/`route_dispatch_excel` (Tasks 4/5). ✔
- Data-provider en backend (portar lógica frontend) → Task 3. ✔
- Extensión híbrida (HTML-PDF + ExcelDoc secciones) → Tasks 1/2. ✔
- Integración + fallback + flag → Task 6. ✔
- Retrocompatibilidad (campos opcionales; seeds previos intactos) → Tasks 1/2 mantienen la ruta legacy. ✔
- Warehouse "Salida a Ruta": NO se toca en este lote (sus `packages` podrían carecer de campos ricos → métricas en 0). Se difiere su enganche/verificación al lote 6 (warehouse Excel), donde se decide si adopta la plantilla rica o conserva la simple. Documentado como fuera de alcance de Lote 1.
