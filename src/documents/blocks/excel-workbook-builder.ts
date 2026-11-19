import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { TemplateEngine } from '../template-engine';
import { RenderContext } from '../documents.types';
import { ExcelDoc, ExcelSheet, ExcelSection, ExcelColumn, ExcelLetterhead, MergeTarget } from './excel-doc.types';

function solid(argb: string): ExcelJS.Fill { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function thin(): Partial<ExcelJS.Borders> {
  const b = { style: 'thin' as const };
  return { top: b, left: b, bottom: b, right: b };
}

/** Resuelve un `MergeTarget`: número fijo, o `ctx.data[fromVar]` (columnas dinámicas, ver B4). */
function resolveMergeTo(target: MergeTarget, ctx: RenderContext): number {
  if (typeof target === 'number') return target;
  const v = ctx.data?.[target.fromVar];
  return typeof v === 'number' && v > 0 ? v : 1;
}

/** Letra de columna 1-based (1='A', 27='AA', …) para armar refs de conditionalFormatting. */
function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** "Vacío" para efectos de `when`: null/undefined/''/array de length 0. */
function isEmptyVar(v: any): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

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
    const ws = wb.addWorksheet(sheet.name, sheet.showGridLines === false ? { views: [{ showGridLines: false }] } : undefined);
    if (sheet.sections?.length) {
      if (sheet.columnWidths) sheet.columnWidths.forEach((w, i) => { if (w != null) ws.getColumn(i + 1).width = w; });
      this.buildSections(ws, sheet.sections, ctx, wb);
      return;
    }

    const columns = sheet.columns ?? [];
    const lastCol = Math.max(columns.length, 1);

    // Ancho, numFmt y alineación por columna, ANTES de agregar filas: los setters de
    // ExcelJS.Column aplican el estilo retroactivamente a toda celda ya existente en la
    // columna, así que si se aplicaran después pisarían el estilo del título/encabezado.
    // Al ir primero, las filas de título/encabezado (que fijan su propio row.font/row.alignment
    // más abajo) quedan por encima del default de columna, y las filas de datos lo heredan.
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.width != null) col.width = c.width;
      if (c.numFmt) col.numFmt = c.numFmt;
      if (c.align) col.alignment = { horizontal: c.align };
    });

    // Título (fila fusionada) + info rows, antes de la tabla.
    if (sheet.title) {
      const row = ws.addRow([this.engine.renderRaw(sheet.title, ctx)]);
      ws.mergeCells(row.number, 1, row.number, lastCol);
      row.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      if (sheet.titleFill) {
        for (let c = 1; c <= lastCol; c++) ws.getCell(row.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sheet.titleFill } };
      }
    }
    for (const info of sheet.infoRows ?? []) {
      ws.addRow([`${info.label}: ${this.engine.renderRaw(info.value, ctx)}`]);
    }

    // Encabezado de columnas.
    const headerRow = ws.addRow(columns.map((c) => c.label));
    if (sheet.headerFont?.bold || sheet.headerFont?.color) {
      headerRow.font = { bold: !!sheet.headerFont.bold, ...(sheet.headerFont.color ? { color: { argb: sheet.headerFont.color } } : {}) };
    }
    if (sheet.headerFill) headerRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sheet.headerFill! } }; });

    // Filas de datos.
    const rows: any[] = sheet.rowsVar && Array.isArray(ctx.data?.[sheet.rowsVar]) ? ctx.data[sheet.rowsVar] : [];
    for (const r of rows) ws.addRow(columns.map((c) => r?.[c.key] ?? ''));

    if (sheet.freezeHeader) ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
    if (sheet.autoFilter) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: lastCol } };
  }

  private buildSections(ws: ExcelJS.Worksheet, sections: ExcelSection[], ctx: RenderContext, wb?: ExcelJS.Workbook) {
    for (const s of sections) {
      // Sección condicional: si `when` está seteado y ctx.data[when] es vacío, se omite entera
      // (título incluido) — evita, p.ej., mostrar "❌ Paquetes faltantes" sin faltantes que listar.
      if (s.kind !== 'spacer' && s.when && isEmptyVar(ctx.data?.[s.when])) continue;
      switch (s.kind) {
        case 'spacer': ws.addRow([]); break;
        case 'title': {
          const mergeTo = resolveMergeTo(s.mergeTo, ctx);
          const row = ws.addRow([this.engine.renderRaw(s.text, ctx)]);
          ws.mergeCells(row.number, 1, row.number, mergeTo);
          row.font = { size: s.font?.size, bold: s.font?.bold, italic: s.font?.italic, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
          row.alignment = { vertical: 'middle', horizontal: s.align ?? 'center' };
          if (s.height) row.height = s.height;
          if (s.fill) for (let c = 1; c <= mergeTo; c++) ws.getCell(row.number, c).fill = solid(s.fill);
          break;
        }
        case 'info': {
          const mergeTo = resolveMergeTo(s.mergeTo, ctx);
          for (const r of s.rows) {
            const row = ws.addRow([this.engine.renderRaw(r.text, ctx)]);
            ws.mergeCells(row.number, 1, row.number, mergeTo);
          }
          break;
        }
        case 'band': {
          const mergeTo = resolveMergeTo(s.mergeTo, ctx);
          const items: any[] = Array.isArray(ctx.data?.[s.rowsVar]) ? ctx.data[s.rowsVar] : [];
          for (const item of items) {
            const row = ws.addRow([this.engine.renderRaw(String(item), ctx)]);
            ws.mergeCells(row.number, 1, row.number, mergeTo);
            row.font = { bold: s.font?.bold, italic: s.font?.italic, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
            row.alignment = { vertical: 'middle', horizontal: s.align ?? 'left' };
            if (s.fill) for (let c = 1; c <= mergeTo; c++) ws.getCell(row.number, c).fill = solid(s.fill);
          }
          break;
        }
        case 'table': this.buildTableSection(ws, s, ctx); break;
        case 'row': {
          const row = ws.addRow([]);
          for (const c of s.cells) {
            const cell = row.getCell(c.col);
            cell.value = c.key ? (ctx.data?.[c.key] ?? '') : this.engine.renderRaw(c.text ?? '', ctx);
            if (c.bold) cell.font = { bold: true };
          }
          break;
        }
        case 'tableGroup': this.buildTableGroup(ws, s, ctx); break;
        case 'letterhead': this.buildLetterhead(ws, s, ctx, wb); break;
      }
    }
  }

  /** Membrete de 2 filas: logo (imagen), bloque de título fusionado y rejilla de datos. */
  private buildLetterhead(ws: ExcelJS.Worksheet, s: ExcelLetterhead, ctx: RenderContext, wb?: ExcelJS.Workbook) {
    const r1 = ws.rowCount + 1;
    const r2 = r1 + 1;
    const height = s.rowHeight ?? 30;
    ws.getRow(r1).height = height;
    ws.getRow(r2).height = height;
    const txt = (t: string) => this.engine.renderRaw(t, ctx);
    const merge = (top: number, bottom: number, from: number, to: number) => {
      if (top !== bottom || from !== to) ws.mergeCells(top, from, bottom, to);
    };

    // Logo: celda fusionada vacía + imagen flotante centrada a lo alto de las 2 filas.
    if (s.logo) {
      merge(r1, r2, s.logo.from, s.logo.to);
      const b64 = ctx.data?.[s.logo.base64Var];
      if (wb && typeof b64 === 'string' && b64) {
        const pxHeight = Math.round(height * 2 * (96 / 72)) - 10;
        const w = Number(ctx.data?.[s.logo.widthVar ?? '']) || 1;
        const h = Number(ctx.data?.[s.logo.heightVar ?? '']) || 1;
        const id = wb.addImage({ base64: b64, extension: 'png' });
        ws.addImage(id, {
          tl: { col: s.logo.from - 1 + 0.15, row: r1 - 1 + 0.1 } as any,
          ext: { width: Math.round(pxHeight * (w / h)), height: pxHeight },
          editAs: 'oneCell',
        });
      }
    }

    // Título + subtítulo (texto enriquecido en una celda fusionada).
    merge(r1, r2, s.title.from, s.title.to);
    const tc = ws.getCell(r1, s.title.from);
    const color = { argb: s.title.color ?? 'FFFFFF' };
    tc.value = {
      richText: [
        { text: txt(s.title.text), font: { bold: true, size: 16, color } },
        ...(s.title.subtitle ? [{ text: '\n' + txt(s.title.subtitle), font: { size: 10, color } }] : []),
      ],
    };
    tc.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    if (s.title.fill) tc.fill = solid(s.title.fill);

    // Rejilla de datos: etiqueta chica (color) arriba, valor en negritas abajo.
    const labelColor = { argb: s.labelColor ?? '9d5137' };
    for (const f of s.fields) {
      const row = f.row === 0 ? r1 : r2;
      merge(row, row, f.from, f.to);
      const c = ws.getCell(row, f.from);
      c.value = {
        richText: [
          { text: txt(f.label).toUpperCase(), font: { bold: true, size: 8, color: labelColor } },
          { text: '\n' + txt(f.value), font: { bold: true, size: 11 } },
        ],
      };
      c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    }

    if (s.bottomBorder) {
      for (let col = 1; col <= s.bottomBorder.to; col++) {
        const c = ws.getCell(r2, col);
        c.border = { ...(c.border ?? {}), bottom: { style: 'medium', color: { argb: s.bottomBorder.color } } };
      }
    }
  }

  /** Tablas "espejo": comparten filas (título propio, encabezado propio, N filas de datos) pero
   * cada una arranca en su propia columna (`startCol`). El "cursor" de filas avanza naturalmente
   * porque `ws.getCell(row, col)` extiende `ws.rowCount` al tocar la última fila del grupo. */
  private buildTableGroup(ws: ExcelJS.Worksheet, s: Extract<ExcelSection, { kind: 'tableGroup' }>, ctx: RenderContext) {
    const tables = s.tables;
    const dataArrays = tables.map((t) => (Array.isArray(ctx.data?.[t.rowsVar]) ? ctx.data[t.rowsVar] : []));
    const maxRows = Math.max(0, ...dataArrays.map((a) => a.length));

    let row = ws.rowCount + 1;

    if (tables.some((t) => t.title)) {
      for (const t of tables) {
        if (!t.title) continue;
        const endCol = t.startCol + t.columns.length - 1;
        const cell = ws.getCell(row, t.startCol);
        cell.value = this.engine.renderRaw(t.title.text, ctx);
        ws.mergeCells(row, t.startCol, row, endCol);
        cell.font = { bold: t.title.font?.bold, ...(t.title.font?.color ? { color: { argb: t.title.font.color } } : {}) };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (t.title.fill) for (let c = t.startCol; c <= endCol; c++) ws.getCell(row, c).fill = solid(t.title.fill);
      }
      row++;
    }

    // Encabezado de columnas (propio por tabla).
    for (const t of tables) {
      t.columns.forEach((c, i) => {
        const col = t.startCol + i;
        if (c.width != null) ws.getColumn(col).width = c.width;
        if (c.numFmt) ws.getColumn(col).numFmt = c.numFmt;
        const cell = ws.getCell(row, col);
        cell.value = c.label;
        if (t.headerFont) cell.font = { bold: t.headerFont.bold, size: t.headerFont.size, ...(t.headerFont.color ? { color: { argb: t.headerFont.color } } : {}) };
      });
    }
    row++;

    const dataStartRow = row;
    for (let i = 0; i < maxRows; i++) {
      const isEven = i % 2 === 0;
      tables.forEach((t, ti) => {
        const item = dataArrays[ti][i];
        t.columns.forEach((c, ci) => {
          const cell = ws.getCell(dataStartRow + i, t.startCol + ci);
          if (item) cell.value = item[c.key] ?? '';
          if (t.bordered) cell.border = thin();
          cell.alignment = { vertical: 'middle', horizontal: t.cellAlign ?? 'left' };
          if (isEven && t.zebraFill) cell.fill = solid(t.zebraFill);
          if (item && t.redFontKey && item[t.redFontKey]) {
            cell.font = { bold: true, color: { argb: t.redFontColor ?? 'FF0000' } };
          }
        });
      });
    }
  }

  private buildTableSection(ws: ExcelJS.Worksheet, s: Extract<ExcelSection, { kind: 'table' }>, ctx: RenderContext) {
    // Columnas efectivas: fijas de inicio + dinámicas (resueltas desde ctx.data, ya armadas por
    // el data-provider, p.ej. una por día del rango) + fijas de fin. Ver B4 Estado de Resultados.
    const dynamicColumns: ExcelColumn[] = s.dynamicColumnsVar && Array.isArray(ctx.data?.[s.dynamicColumnsVar]) ? ctx.data[s.dynamicColumnsVar] : [];
    const columns: ExcelColumn[] = [...s.columns, ...dynamicColumns, ...(s.columnsEnd ?? [])];

    columns.forEach((c, i) => { if (c.width != null) ws.getColumn(i + 1).width = c.width; });
    const headerRow = ws.addRow(columns.map((c) => c.label));
    if (s.headerHeight) headerRow.height = s.headerHeight;
    const headerBorder = s.headerBorder
      ? { top: { style: s.headerBorder.style, color: { argb: s.headerBorder.color } }, bottom: { style: s.headerBorder.style, color: { argb: s.headerBorder.color } } }
      : null;
    headerRow.eachCell((cell) => {
      if (s.headerFont) cell.font = { bold: s.headerFont.bold, ...(s.headerFont.color ? { color: { argb: s.headerFont.color } } : {}) };
      if (s.headerFill) cell.fill = solid(s.headerFill);
      cell.alignment = { vertical: 'middle', horizontal: s.headerAlign ?? 'left' };
      if (headerBorder) cell.border = headerBorder as any;
      else if (s.bordered) cell.border = thin();
    });
    const rows: any[] = Array.isArray(ctx.data?.[s.rowsVar]) ? ctx.data[s.rowsVar] : [];
    const lastRowBorder = s.lastRowBorder
      ? { top: { style: s.lastRowBorder.style, color: { argb: s.lastRowBorder.color } }, bottom: { style: s.lastRowBorder.style, color: { argb: s.lastRowBorder.color } } }
      : null;
    rows.forEach((r, idx) => {
      const dataRow = ws.addRow(columns.map((c) => r?.[c.key] ?? ''));
      const fill = s.rowFillKey ? r?.[s.rowFillKey] : null;
      // Estilos de fila completa (bold/font color), p.ej. filas de título/total dentro de una
      // única tabla con columnas dinámicas (B4 Estado de Resultados) — ganan sobre `thin()` pero
      // ceden ante el semáforo por celda (fillFromKey/fontColorFromKey), más específico.
      const rowBold = s.rowBoldKey ? !!r?.[s.rowBoldKey] : false;
      const rowFontColor = s.rowFontColorKey ? r?.[s.rowFontColorKey] : null;
      const isLastRow = idx === rows.length - 1;
      // Todas las celdas de la fila, también las vacías: si no, el fondo (zebra/semáforo) y los
      // bordes quedaban con huecos donde no había valor (p. ej. "Cobro" vacío).
      columns.forEach((_, i) => {
        const col = i + 1;
        const cell = dataRow.getCell(col);
        const c = columns[col - 1];
        if (fill) cell.fill = solid(fill);
        if (s.bordered) cell.border = thin();
        cell.alignment = { vertical: 'middle', horizontal: c?.align ?? s.cellAlign ?? 'left', ...(s.wrap ? { wrapText: true } : {}) };
        if (c?.numFmt) cell.numFmt = c.numFmt;
        if (rowBold || rowFontColor) cell.font = { bold: rowBold || undefined, ...(rowFontColor ? { color: { argb: rowFontColor } } : {}) };
        // Semáforo por celda (fiel a B3 Reporte de Choferes): fillFromKey/fontColorFromKey leen
        // el argb de un campo de LA FILA, distinto por columna, y ganan sobre rowFillKey/thin()
        // y sobre los estilos de fila completa de arriba.
        const colFill = c?.fillFromKey ? r?.[c.fillFromKey] : null;
        if (colFill) cell.fill = solid(colFill);
        const colFontColor = c?.fontColorFromKey ? r?.[c.fontColorFromKey] : null;
        if (colFontColor) cell.font = { bold: true, color: { argb: colFontColor } };
        if (isLastRow && lastRowBorder) cell.border = lastRowBorder as any;
      });
    });
    // Conserva la vista de la hoja (p. ej. sin líneas de cuadrícula) al fijar el encabezado.
    if (s.freezeHeader) ws.views = [{ showGridLines: ws.views?.[0]?.showGridLines ?? true, state: 'frozen', ySplit: headerRow.number }];
    if (s.autoFilter) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: columns.length } };

    // colorScale mínimo (aproximación: blanco -> color, sobre el rango de filas de datos de la
    // columna indicada). Ver B4 Dashboard (semáforo verde en MONTO ingreso, rojo en MONTO egreso).
    if (s.colorScale?.length && rows.length > 0) {
      const dataStartRow = headerRow.number + 1;
      const dataEndRow = headerRow.number + rows.length;
      for (const cs of s.colorScale) {
        const letter = colLetter(cs.col);
        ws.addConditionalFormatting({
          ref: `${letter}${dataStartRow}:${letter}${dataEndRow}`,
          rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: cs.to }] }],
        });
      }
    }
  }
}
