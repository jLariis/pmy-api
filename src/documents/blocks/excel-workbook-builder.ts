import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { TemplateEngine } from '../template-engine';
import { RenderContext } from '../documents.types';
import { ExcelDoc, ExcelSheet, ExcelSection } from './excel-doc.types';

function solid(argb: string): ExcelJS.Fill { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function thin(): Partial<ExcelJS.Borders> {
  const b = { style: 'thin' as const };
  return { top: b, left: b, bottom: b, right: b };
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
      this.buildSections(ws, sheet.sections, ctx);
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

  private buildSections(ws: ExcelJS.Worksheet, sections: ExcelSection[], ctx: RenderContext) {
    for (const s of sections) {
      // Sección condicional: si `when` está seteado y ctx.data[when] es vacío, se omite entera
      // (título incluido) — evita, p.ej., mostrar "❌ Paquetes faltantes" sin faltantes que listar.
      if (s.kind !== 'spacer' && s.when && isEmptyVar(ctx.data?.[s.when])) continue;
      switch (s.kind) {
        case 'spacer': ws.addRow([]); break;
        case 'title': {
          const row = ws.addRow([this.engine.renderRaw(s.text, ctx)]);
          ws.mergeCells(row.number, 1, row.number, s.mergeTo);
          row.font = { size: s.font?.size, bold: s.font?.bold, italic: s.font?.italic, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
          row.alignment = { vertical: 'middle', horizontal: 'center' };
          if (s.height) row.height = s.height;
          if (s.fill) for (let c = 1; c <= s.mergeTo; c++) ws.getCell(row.number, c).fill = solid(s.fill);
          break;
        }
        case 'info':
          for (const r of s.rows) {
            const row = ws.addRow([this.engine.renderRaw(r.text, ctx)]);
            ws.mergeCells(row.number, 1, row.number, s.mergeTo);
          }
          break;
        case 'band': {
          const items: any[] = Array.isArray(ctx.data?.[s.rowsVar]) ? ctx.data[s.rowsVar] : [];
          for (const item of items) {
            const row = ws.addRow([this.engine.renderRaw(String(item), ctx)]);
            ws.mergeCells(row.number, 1, row.number, s.mergeTo);
            row.font = { bold: s.font?.bold, italic: s.font?.italic, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
            row.alignment = { vertical: 'middle', horizontal: s.align ?? 'left' };
            if (s.fill) for (let c = 1; c <= s.mergeTo; c++) ws.getCell(row.number, c).fill = solid(s.fill);
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
    s.columns.forEach((c, i) => { if (c.width != null) ws.getColumn(i + 1).width = c.width; });
    const headerRow = ws.addRow(s.columns.map((c) => c.label));
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
      const dataRow = ws.addRow(s.columns.map((c) => r?.[c.key] ?? ''));
      const fill = s.rowFillKey ? r?.[s.rowFillKey] : null;
      const isLastRow = idx === rows.length - 1;
      dataRow.eachCell((cell, col) => {
        const c = s.columns[col - 1];
        if (fill) cell.fill = solid(fill);
        if (s.bordered) cell.border = thin();
        cell.alignment = { vertical: 'middle', horizontal: c?.align ?? s.cellAlign ?? 'left', ...(s.wrap ? { wrapText: true } : {}) };
        if (c?.numFmt) cell.numFmt = c.numFmt;
        // Semáforo por celda (fiel a B3 Reporte de Choferes): fillFromKey/fontColorFromKey leen
        // el argb de un campo de LA FILA, distinto por columna, y ganan sobre rowFillKey/thin().
        const colFill = c?.fillFromKey ? r?.[c.fillFromKey] : null;
        if (colFill) cell.fill = solid(colFill);
        const colFontColor = c?.fontColorFromKey ? r?.[c.fontColorFromKey] : null;
        if (colFontColor) cell.font = { bold: true, color: { argb: colFontColor } };
        if (isLastRow && lastRowBorder) cell.border = lastRowBorder as any;
      });
    });
    if (s.freezeHeader) ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
    if (s.autoFilter) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: s.columns.length } };
  }
}
