import { cleanTracking, guidesFromDhlBody, guidesFromSheets } from './guide-index.util';

describe('guide-index.util', () => {
  it('cleanTracking limpia apóstrofo/espacios y descarta lo que no es guía', () => {
    expect(cleanTracking("'8858 1234 5678")).toBe('885812345678');
    expect(cleanTracking('jd014600012345678901')).toBe('JD014600012345678901');
    expect(cleanTracking('TRACKING')).toBeNull();
    expect(cleanTracking('12345')).toBeNull();
    expect(cleanTracking('')).toBeNull();
  });

  it('libro de varias hojas: cada hoja con su tipo; el número del archivo solo va en la hoja principal', () => {
    const sheets = [
      { name: 'YAQUI', role: null, tsv: 'Tracking Number\tZIP\n111122223333\t85000\n111122224444\t85000', rows: 2 },
      { name: 'F2', role: 'f2' as const, tsv: 'Tracking Number\n555566667777', rows: 1 },
      { name: 'COD', role: 'cod' as const, tsv: 'Tracking Number\tAmount\n111122223333\t100', rows: 1 },
    ];
    const out = guidesFromSheets({ id: 'a1', kind: 'master', consNumber: '305800000001' }, sheets);
    expect(out).toEqual([
      { inboxAttachmentId: 'a1', sheet: 'YAQUI', unitKind: 'master', unitConsNumber: '305800000001', trackingNumber: '111122223333' },
      { inboxAttachmentId: 'a1', sheet: 'YAQUI', unitKind: 'master', unitConsNumber: '305800000001', trackingNumber: '111122224444' },
      { inboxAttachmentId: 'a1', sheet: 'F2', unitKind: 'f2', unitConsNumber: null, trackingNumber: '555566667777' },
      { inboxAttachmentId: 'a1', sheet: 'COD', unitKind: 'cod', unitConsNumber: null, trackingNumber: '111122223333' },
    ]);
  });

  it('archivo de una hoja: sin nombre de hoja y sin repetidos', () => {
    const sheets = [{ name: 'Sheet1', role: null, tsv: 'Guia\n111122223333\n111122223333', rows: 2 }];
    expect(guidesFromSheets({ id: 'a2', kind: 'f2', consNumber: null }, sheets)).toEqual([
      { inboxAttachmentId: 'a2', sheet: null, unitKind: 'f2', unitConsNumber: null, trackingNumber: '111122223333' },
    ]);
  });

  it('guidesFromDhlBody saca las guías de los bloques AWB', () => {
    const body = 'Hola\nAWB : 1234567890\nRemitente…\n  AWB: 9876543210 \nAWB : 1234567890';
    expect(guidesFromDhlBody(body)).toEqual(['1234567890', '9876543210']);
    expect(guidesFromDhlBody(null)).toEqual([]);
  });
});
