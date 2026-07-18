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

  it('renderiza secciones: title, info, band y table con rowFill', async () => {
    const doc2: any = { sheets: [{
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
    const buf = await builder.build(doc2, ctx({
      title: 'Salida a Ruta', routeNamesArrow: 'R1 -> R2', stats: { total: 2 },
      invalidChunks: ['📦 AAA'],
      rows: [{ index: 1, trackingNumber: 'T1', rowFill: 'F2F2F2' }, { index: 2, trackingNumber: 'T2', rowFill: 'fff2cc' }],
    }));
    const wb = await load(buf);
    const ws = wb.getWorksheet('Despacho')!;
    expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('ef883a');
    expect(String(ws.getRow(3).getCell(1).value)).toBe('Ruta: R1 -> R2');
    const values: string[] = [];
    let headerRowNum = 0;
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      values.push(String(r.getCell(1).value));
      if (r.getCell(1).value === 'No.') headerRowNum = n;
    });
    expect(values).toContain('📦 AAA');
    expect(headerRowNum).toBeGreaterThan(0);
    expect((ws.getRow(headerRowNum).getCell(1).fill as any).fgColor.argb).toBe('8c5e4e');
    const paidRow = headerRowNum + 2; // segunda fila de datos
    expect((ws.getRow(paidRow).getCell(1).fill as any).fgColor.argb).toBe('fff2cc');
  });

  it('no permite que la alineación de una columna pise el título centrado', async () => {
    const withTitleAndAlign: ExcelDoc = { sheets: [{
      name: 'T',
      title: 'REPORTE',
      columns: [{ key: 'amount', label: 'Importe', align: 'right' }],
      rowsVar: 'rows',
    }] };
    const buf = await builder.build(withTitleAndAlign, ctx({ rows: [{ amount: 10 }] }));
    const wb = await load(buf);
    const ws = wb.getWorksheet('T')!;
    // Fila 1 = título fusionado: debe seguir centrado, no heredar el align:'right' de la columna.
    expect(ws.getRow(1).getCell(1).alignment?.horizontal).toBe('center');
    // Fila 3 = dato: sí debe heredar el default de alineación de la columna.
    expect(ws.getRow(3).getCell(1).alignment?.horizontal).toBe('right');
  });
});
