import * as XLSX from 'xlsx';
import {
  parsePaymentCell,
  pickSheetWithHeaders,
  parseDynamicSheet,
  parseDynamicFileF2,
} from './file-upload.utils';

/** Helper: arma un workbook en memoria a partir de hojas {nombre: filas[][]}. */
function makeWorkbook(sheets: Record<string, any[][]>): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return book;
}

const HEADERS = [
  'Tracking Number', 'Recip Name', 'Recip Addr', 'Recip City',
  'Recip Postal', 'Commit Date', 'Commit Time', 'Recip Phone', 'COD',
];
const row = (tn: string, opts: Partial<{ name: string; addr: string; city: string; zip: string; date: string; time: string; phone: string; cod: string }> = {}) =>
  [tn, opts.name ?? 'Cliente', opts.addr ?? 'Calle 1', opts.city ?? 'Hermosillo', opts.zip ?? '83000', opts.date ?? '06/28/2026', opts.time ?? '', opts.phone ?? '6620000000', opts.cod ?? ''];

describe('parsePaymentCell', () => {
  it('devuelve null para vacío/sin monto', () => {
    expect(parsePaymentCell(null)).toBeNull();
    expect(parsePaymentCell(undefined)).toBeNull();
    expect(parsePaymentCell('')).toBeNull();
    expect(parsePaymentCell('   ')).toBeNull();
    expect(parsePaymentCell('ROD')).toBeNull();      // tipo sin monto
    expect(parsePaymentCell('abc')).toBeNull();
    expect(parsePaymentCell('0')).toBeNull();        // monto <= 0
  });

  it('extrae monto + tipo COD/FTC/ROD', () => {
    expect(parsePaymentCell('COD 1,234.56')).toEqual({ amount: 1234.56, type: 'COD' });
    expect(parsePaymentCell('FTC $2,000')).toEqual({ amount: 2000, type: 'FTC' });
    expect(parsePaymentCell('ROD 150.00')).toEqual({ amount: 150, type: 'ROD' });
  });

  it('acepta celda numérica (no string)', () => {
    expect(parsePaymentCell(1234.5)).toEqual({ amount: 1234.5, type: null });
    expect(parsePaymentCell(500)).toEqual({ amount: 500, type: null });
  });

  it('maneja separadores europeos y coma decimal', () => {
    expect(parsePaymentCell('1.234,56')).toEqual({ amount: 1234.56, type: null }); // miles '.' decimal ','
    expect(parsePaymentCell('1,50')).toEqual({ amount: 1.5, type: null });          // coma decimal
    expect(parsePaymentCell('cod: 1,234')!.amount).toBe(1234);                       // coma de miles
  });

  it('no toma el primer dígito suelto (bug viejo)', () => {
    // "COD 1,234.00" antes devolvía 1; ahora el monto real
    expect(parsePaymentCell('COD 1,234.00')!.amount).toBe(1234);
  });
});

describe('pickSheetWithHeaders', () => {
  it('toma la única hoja válida', () => {
    const wb = makeWorkbook({ Datos: [HEADERS, row('123456789012')] });
    const { sheetName } = pickSheetWithHeaders(wb);
    expect(sheetName).toBe('Datos');
  });

  it('salta una hoja de portada sin encabezados y usa la de datos', () => {
    const wb = makeWorkbook({
      Portada: [['Reporte de consolidado'], ['Generado el', '2026-06-28']],
      Datos: [HEADERS, row('111111111111')],
    });
    expect(pickSheetWithHeaders(wb).sheetName).toBe('Datos');
  });

  it('salta una hoja con headers pero SIN columna de guía', () => {
    const wb = makeWorkbook({
      Resumen: [['Fecha', 'Ciudad'], ['2026-06-28', 'Hermosillo']], // 'fecha'/'ciudad' conocidas pero sin tracking
      Datos: [HEADERS, row('222222222222')],
    });
    expect(pickSheetWithHeaders(wb).sheetName).toBe('Datos');
  });

  it('lanza error descriptivo si NINGUNA hoja sirve', () => {
    const wb = makeWorkbook({
      H1: [['col a', 'col b'], ['x', 'y']],
      H2: [['Fecha'], ['2026-06-28']], // conocida pero sin tracking
    });
    expect(() => pickSheetWithHeaders(wb)).toThrow(/columnas necesarias/i);
  });
});

describe('parseDynamicSheet', () => {
  it('mapea campos y filtra filas sin guía', () => {
    const wb = makeWorkbook({
      Datos: [
        HEADERS,
        row('490402058189', { name: 'PROMOTORA', cod: 'COD 1,234.00' }),
        row('', { name: 'BASURA SIN GUIA' }),          // se ignora
        row('710874458950', { name: 'CARLOS' }),
      ],
    });
    const res = parseDynamicSheet(wb, { fileName: 'master.xlsx' });
    expect(res).toHaveLength(2);
    expect(res[0].trackingNumber).toBe('490402058189');
    expect(res[0].recipientName).toBe('PROMOTORA');
    expect(res[0].commitDate).toBe('2026-06-28');
    expect(res[0].payment).toBe('COD 1,234.00'); // raw COD (se interpreta luego con parsePaymentCell)
    expect(res[1].trackingNumber).toBe('710874458950');
  });

  it('encuentra los datos aunque estén en la 2ª hoja (multi-hoja)', () => {
    const wb = makeWorkbook({
      Portada: [['Consolidado X'], ['Total', 2]],
      Guias: [HEADERS, row('333333333333'), row('444444444444')],
    });
    const res = parseDynamicSheet(wb, { fileName: 'aereo.xlsx' });
    expect(res.map((r) => r.trackingNumber)).toEqual(['333333333333', '444444444444']);
  });

  it('lanza error si ninguna hoja tiene columna de guía', () => {
    const wb = makeWorkbook({ Solo: [['Fecha', 'Ciudad'], ['2026-06-28', 'HMO']] });
    expect(() => parseDynamicSheet(wb, { fileName: 'x.xlsx' })).toThrow(/columnas necesarias/i);
  });

  it('default de campos faltantes', () => {
    const headersMin = ['Tracking Number'];
    const wb = makeWorkbook({ Datos: [headersMin, ['555555555555']] });
    const res = parseDynamicSheet(wb, { fileName: 'x.xlsx' });
    expect(res).toHaveLength(1);
    expect(res[0].recipientName).toBe('Sin Nombre');
    expect(res[0].recipientAddress).toBe('Sin Dirección');
    expect(res[0].recipientZip).toBe('N/A');
  });
});

describe('parseDynamicFileF2', () => {
  it('mapea y filtra filas sin guía', () => {
    const wb = makeWorkbook({
      F2: [HEADERS, row('999999999999', { name: 'TIENDA' }), row(''), row('888888888888')],
    });
    const { sheet } = pickSheetWithHeaders(wb);
    const res = parseDynamicFileF2(sheet);
    expect(res.map((r) => r.trackingNumber)).toEqual(['999999999999', '888888888888']);
    expect(res[0].recipientName).toBe('TIENDA');
  });
});
