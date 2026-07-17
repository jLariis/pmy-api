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
