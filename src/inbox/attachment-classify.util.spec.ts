import * as XLSX from 'xlsx';
import { classifyByName, finalizeKinds, summarizeWorkbook } from './attachment-classify.util';
import { AEREO, CABO, CABORCA, SUR } from './__fixtures__/emails';

function book(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('attachment-classify.util', () => {
  it('clasifica por nombre los adjuntos reales', () => {
    expect(CABO.attachments.map(classifyByName)).toEqual(['master', 'ccp']);
    expect(SUR.attachments.map(classifyByName)).toEqual(['ccp', 'f2', 'master']);
    expect(AEREO.attachments.map(classifyByName)).toEqual(['high_value', 'master_aereo', 'high_value', 'master_aereo']);
    expect(CABORCA.attachments.map(classifyByName)).toEqual(['master', 'pdf']);
    expect(classifyByName('reporte.docx')).toBe('other');
    expect(classifyByName('archivo.xlsx')).toBeNull();
  });

  it('CCP se ignora cuando hay master', () => {
    const k = finalizeKinds([
      { filename: 'CARGA.xlsx', byName: 'master', summary: null },
      { filename: 'CCP.xlsx', byName: 'ccp', summary: null },
    ]);
    expect(k).toEqual(['master', 'ccp_ignored']);
    expect(finalizeKinds([{ filename: 'CCP.xlsx', byName: 'ccp', summary: null }])).toEqual(['ccp']);
  });

  it('nombre desconocido + columnas FedEx → master', () => {
    const k = finalizeKinds([
      { filename: 'x.xlsx', byName: null, summary: { rowCount: 3, zips: {}, cities: {}, looksFedex: true, isDhl: false } },
    ]);
    expect(k).toEqual(['master']);
  });

  it('resume CP y ciudades de los destinatarios', () => {
    const s = summarizeWorkbook(
      book([
        ['Reporte FedEx'],
        ['Tracking Number', 'Recip Name', 'Recip City', 'Recip Postal'],
        ['383905050153', 'A', 'Caborca', '83600'],
        ['383905050154', 'B', 'CABORCA', 83600],
        ['383905050155', 'C', 'Pitiquito', '83650'],
        ['', '', '', ''],
      ]),
    );
    expect(s.rowCount).toBe(3);
    expect(s.zips).toEqual({ '83600': 2, '83650': 1 });
    expect(s.cities).toEqual({ CABORCA: 2, PITIQUITO: 1 });
    expect(s.looksFedex).toBe(true);
    expect(s.isDhl).toBe(false);
  });

  it('archivo dañado → parseError en llano', () => {
    const s = summarizeWorkbook(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]));
    expect(s.rowCount).toBe(0);
  });
});
