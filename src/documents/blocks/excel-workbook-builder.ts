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
    const ws = wb.addWorksheet(sheet.name);
    if (sheet.sections?.length) { this.buildSections(ws, sheet.sections, ctx); return; }

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
          row.font = { size: s.font?.size, bold: s.font?.bold, ...(s.font?.color ? { color: { argb: s.font.color } } : {}) };
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
    headerRow.eachCell((cell) => {
      if (s.headerFont) cell.font = { bold: s.headerFont.bold, ...(s.headerFont.color ? { color: { argb: s.headerFont.color } } : {}) };
      if (s.headerFill) cell.fill = solid(s.headerFill);
      cell.alignment = { vertical: 'middle', horizontal: s.headerAlign ?? 'left' };
      if (s.bordered) cell.border = thin();
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
}
