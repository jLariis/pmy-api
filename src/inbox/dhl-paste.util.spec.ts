import * as XLSX from 'xlsx';
import { dhlDueDatesFromWorkbook, dhlPasteText } from './dhl-paste.util';

// Cuerpo de un reenvío DHL (datos inventados, formato real del correo de DHL MX).
const BODY = [
  'Buenas tardes',
  '________________________________',
  'De: AGENTE DHL (DHL MX) <agente@dhl.com>',
  'Enviado: martes, 26 de mayo de 2026 16:19',
  'Asunto: FD VICAM',
  'Please consider the environment before printing this e-mail',
  'AWB : 8303014613',
  'Orig  Dest  Shipment Time     Prod  Pcs  Kilos  Decl. Value    Description of Goods',
  '-----------------------------------------------------------------------------------',
  'GDL   CEN   2026-08-31 20:51  G     1    0.60   454.98 MXN     Antena',
  'Shipper                                                 Receiver',
  'Name   : GDL1                                           Name   : JUAN PRUEBA',
  'Zip    : 45672                                          Zip    : 85270',
].join('\n');

describe('dhlPasteText', () => {
  it('toma el cuerpo desde el primer "AWB :" (sin firma ni encabezados del reenvío)', () => {
    const t = dhlPasteText(BODY)!;
    expect(t.startsWith('AWB : 8303014613')).toBe(true);
    expect(t).not.toContain('De: AGENTE');
    // Respeta los espacios entre columnas (el lector DHL separa remitente/destinatario por ellos).
    expect(t).toContain('Name   : GDL1                                           Name   : JUAN PRUEBA');
  });

  it('sin bloques AWB → null', () => {
    expect(dhlPasteText('CONFIDENTIALITY NOTICE: This message is from DHL')).toBeNull();
    expect(dhlPasteText(null)).toBeNull();
  });
});

describe('dhlDueDatesFromWorkbook', () => {
  it('vencimiento por guía y por JD desde el libro DHL de 3 hojas', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['HWB No', 'Rcvr Addr 1', 'Rcvr Addr 2', 'Rcvr Postcode', 'EDD'],
      ['8303014613', 'Calle 1', '', '85270', new Date(2026, 8, 14)],
    ]), 'Shipment');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['HWB No', 'Piece ID', 'Receiver Name', 'EDD'],
      ['8303014613', 'JD0081109268303014613', 'JUAN PRUEBA', new Date(2026, 8, 14)],
    ]), 'Piece');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['HWB No', 'Piece ID', 'Event Cd'], ['8303014613', 'JD0081109268303014613', 'FD']]), 'Event');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(dhlDueDatesFromWorkbook(buf)).toEqual({ '8303014613': '2026-09-14', JD0081109268303014613: '2026-09-14' });
  });

  it('hoja simple sin vencimiento → {} (se captura en la tabla)', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['6599722021', 'Calle 2', 'Bacobampo', '85285', 'CEN', 'FD']]), 'VICAM');
    expect(dhlDueDatesFromWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)).toEqual({});
  });

  it('archivo dañado → {}', () => {
    expect(dhlDueDatesFromWorkbook(Buffer.from('no es excel'))).toEqual({});
  });
});
