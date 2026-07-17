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
