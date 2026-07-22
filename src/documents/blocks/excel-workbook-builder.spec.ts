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

  it('sección `title`/`band` con `when` se omite si el valor es vacío, y aparece si no lo es', async () => {
    const docWhen: any = { sheets: [{
      name: 'Cond',
      sections: [
        { kind: 'title', text: '❌ Faltantes', mergeTo: 1, when: 'faltantes' },
        { kind: 'band', rowsVar: 'faltantes', mergeTo: 1, when: 'faltantes' },
      ],
    }] };

    const bufEmpty = await builder.build(docWhen, ctx({ faltantes: [] }));
    const wsEmpty = (await load(bufEmpty)).getWorksheet('Cond')!;
    expect(wsEmpty.rowCount).toBe(0);

    const bufFilled = await builder.build(docWhen, ctx({ faltantes: ['X1'] }));
    const wsFilled = (await load(bufFilled)).getWorksheet('Cond')!;
    const values: string[] = [];
    wsFilled.eachRow({ includeEmpty: true }, (r) => values.push(String(r.getCell(1).value)));
    expect(values).toContain('❌ Faltantes');
    expect(values).toContain('X1');
  });

  it('columnWidths (sheet-level) aplica anchos antes de las secciones', async () => {
    const doc2: any = { sheets: [{ name: 'W', columnWidths: [8, 25, 5, 5, 18], sections: [{ kind: 'spacer' }] }] };
    const buf = await builder.build(doc2, ctx({}));
    const ws = (await load(buf)).getWorksheet('W')!;
    expect(ws.getColumn(1).width).toBe(8);
    expect(ws.getColumn(2).width).toBe(25);
    expect(ws.getColumn(5).width).toBe(18);
  });

  it('sección `row`: celdas en columnas arbitrarias de una sola fila (texto literal y `key` crudo)', async () => {
    const doc2: any = { sheets: [{ name: 'R', sections: [
      { kind: 'row', cells: [
        { col: 1, text: 'TOTAL A:', bold: true },
        { col: 2, key: 'totalA', bold: true },
        { col: 4, text: 'TOTAL B:', bold: true },
        { col: 5, key: 'totalB', bold: true },
      ] },
    ] }] };
    const buf = await builder.build(doc2, ctx({ totalA: 3, totalB: 7 }));
    const ws = (await load(buf)).getWorksheet('R')!;
    const row = ws.getRow(1);
    expect(row.getCell(1).value).toBe('TOTAL A:');
    expect(row.getCell(2).value).toBe(3); // crudo (número, no string interpolado)
    expect(row.getCell(4).value).toBe('TOTAL B:');
    expect(row.getCell(5).value).toBe(7);
    expect(row.getCell(1).font?.bold).toBe(true);
    expect(row.getCell(3).value).toBeFalsy(); // columna hueca sin celda
  });

  it('sección `band` admite `align` e `italic` (p.ej. leyenda centrada en cursiva)', async () => {
    const doc2: any = { sheets: [{ name: 'B', sections: [
      { kind: 'band', rowsVar: 'legend', mergeTo: 3, align: 'center', font: { italic: true } },
    ] }] };
    const buf = await builder.build(doc2, ctx({ legend: ['nota 1', 'nota 2'] }));
    const ws = (await load(buf)).getWorksheet('B')!;
    expect(ws.getRow(1).getCell(1).alignment?.horizontal).toBe('center');
    expect(ws.getRow(1).getCell(1).font?.italic).toBe(true);
    expect(ws.getRow(1).getCell(1).value).toBe('nota 1');
  });

  it('sección `tableGroup`: dos tablas espejo comparten filas, columnas distintas, zebra por posición y fuente roja condicional', async () => {
    const doc2: any = { sheets: [{ name: 'G', sections: [
      { kind: 'tableGroup', tables: [
        {
          startCol: 1,
          title: { text: 'IZQUIERDA', fill: '662D91', font: { bold: true, color: 'FFFFFF' } },
          columns: [{ key: 'trackingNumber', label: 'GUIA' }, { key: 'motivo', label: 'MOTIVO' }],
          headerFont: { bold: true }, bordered: true, cellAlign: 'center', zebraFill: 'F9F9F9',
          redFontKey: 'isDex', redFontColor: 'FF0000',
          rowsVar: 'left',
        },
        {
          startCol: 4,
          title: { text: 'DERECHA', fill: 'FF6600', font: { bold: true, color: 'FFFFFF' } },
          columns: [{ key: 'trackingNumber', label: 'GUIA' }],
          headerFont: { bold: true }, bordered: true, cellAlign: 'center',
          rowsVar: 'right',
        },
      ] },
    ] }] };
    const buf = await builder.build(doc2, ctx({
      left: [
        { trackingNumber: 'L1', motivo: 'DEX03', isDex: true },
        { trackingNumber: 'L2', motivo: 'Devuelto', isDex: false },
      ],
      right: [{ trackingNumber: 'R1' }], // más corta que `left`: fila 2 de la derecha queda vacía
    }));
    const ws = (await load(buf)).getWorksheet('G')!;
    // Fila 1: títulos fusionados propios
    expect(ws.getCell(1, 1).value).toBe('IZQUIERDA');
    expect((ws.getCell(1, 1).fill as any).fgColor.argb).toBe('662D91');
    expect(ws.getCell(1, 4).value).toBe('DERECHA');
    expect((ws.getCell(1, 4).fill as any).fgColor.argb).toBe('FF6600');
    // Fila 2: encabezados de columna propios
    expect(ws.getCell(2, 1).value).toBe('GUIA');
    expect(ws.getCell(2, 2).value).toBe('MOTIVO');
    expect(ws.getCell(2, 4).value).toBe('GUIA');
    // Filas 3-4: datos, alineados por índice de fila (no por longitud de cada tabla)
    expect(ws.getCell(3, 1).value).toBe('L1');
    expect(ws.getCell(3, 4).value).toBe('R1');
    expect(ws.getCell(4, 1).value).toBe('L2');
    expect(ws.getCell(4, 4).value ?? '').toBe(''); // la tabla derecha no tiene 2º dato
    // Zebra por posición (fila 0-based par -> fila de hoja 3): aplica aunque falte dato en la otra tabla
    expect((ws.getCell(3, 1).fill as any).fgColor.argb).toBe('F9F9F9');
    expect((ws.getCell(3, 4).fill as any)?.fgColor?.argb).toBeUndefined(); // tabla derecha sin zebraFill
    // Fuente roja condicional solo cuando el dato la activa
    expect(ws.getCell(3, 2).font?.color?.argb).toBe('FF0000'); // MOTIVO de L1 (DEX)
    expect(ws.getCell(4, 2).font?.color?.argb).toBeUndefined(); // MOTIVO de L2 (no DEX)
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
