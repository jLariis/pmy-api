import { BadRequestException } from '@nestjs/common';
import { normalizeTracking, parsePastedRows, classifyMasterRows, hashRows } from './import-jobs.util';
import { CanonicalRow } from './import-jobs.types';

describe('import-jobs.util', () => {
  describe('normalizeTracking', () => {
    it('limpia float .0, notación científica y separadores', () => {
      expect(normalizeTracking('383012036065.0')).toBe('383012036065');
      expect(normalizeTracking('3830 1203 6065')).toBe('383012036065');
      expect(normalizeTracking(' 794000112233 ')).toBe('794000112233');
    });
    it('no toca ids alfanuméricos (DHL)', () => {
      expect(normalizeTracking('JD0123ABC')).toBe('JD0123ABC');
    });
  });

  describe('parsePastedRows', () => {
    it('normaliza guía, hace trim y omite filas sin guía', () => {
      const out = parsePastedRows(
        [
          { trackingNumber: '383012036065.0', recipientName: '  Juan  ', cod: 'COD 1250.00' },
          { trackingNumber: '', recipientName: 'sin guia' },
        ],
        'master',
      );
      expect(out.totalRows).toBe(1);
      expect(out.rows[0].trackingNumber).toBe('383012036065');
      expect(out.rows[0].recipientName).toBe('Juan');
      expect(out.rows[0].cod).toBe('COD 1250.00');
    });
    it('lanza 400 si no hay filas con guía', () => {
      expect(() => parsePastedRows([{ trackingNumber: '' }], 'master')).toThrow(BadRequestException);
      expect(() => parsePastedRows([], 'master')).toThrow(BadRequestException);
      expect(() => parsePastedRows(null, 'master')).toThrow(BadRequestException);
    });
  });

  describe('classifyMasterRows', () => {
    const RET = ['devuelto_a_fedex'];
    const rows: CanonicalRow[] = [
      { trackingNumber: 'A' }, // nueva
      { trackingNumber: 'B' }, // duplicada en este cons
      { trackingNumber: 'C' }, // reingreso desde otro cons (no devuelta)
      { trackingNumber: 'D' }, // reingreso ya devuelto
    ];
    const existing = new Map<string, { consolidatedId: string | null; status: string }>([
      ['B', { consolidatedId: 'CONS1', status: 'pendiente' }],
      ['C', { consolidatedId: 'CONS0', status: 'pendiente' }],
      ['D', { consolidatedId: 'CONS0', status: 'devuelto_a_fedex' }],
    ]);
    it('separa nuevas, duplicadas y reingresos', () => {
      const r = classifyMasterRows(rows, existing, 'CONS1', RET);
      expect(r.toInsert.map((x) => x.trackingNumber).sort()).toEqual(['A', 'C', 'D']);
      expect(r.duplicated.map((x) => x.trackingNumber)).toEqual(['B']);
      expect(r.recycledTrackings.sort()).toEqual(['C', 'D']);
      expect(r.toMarkReturned).toEqual(['C']); // D ya estaba devuelta → no re-marcar
    });
  });

  describe('hashRows', () => {
    it('es estable ante reordenamiento de claves', () => {
      const a = hashRows([{ trackingNumber: 'A', cod: 'COD 10' } as CanonicalRow]);
      const b = hashRows([{ cod: 'COD 10', trackingNumber: 'A' } as CanonicalRow]);
      expect(a).toBe(b);
    });
    it('cambia si cambian los datos', () => {
      expect(hashRows([{ trackingNumber: 'A' } as CanonicalRow]))
        .not.toBe(hashRows([{ trackingNumber: 'B' } as CanonicalRow]));
    });
  });
});
