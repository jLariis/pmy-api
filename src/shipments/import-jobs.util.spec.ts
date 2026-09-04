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

  // ===========================================================================
  // Subida de consolidados SIN reglas de paquete (sep-2026).
  //
  // Decisión de producto: dejamos de perder guías por dedup/reingreso. La subida
  // ya NO aplica ninguna regla de paquete; la única regla que queda (find-or-create
  // del consolidado por consNumber) vive en el llamador, no aquí. Por eso
  // `classifyMasterRows` mete TODO en `toInsert` y deja duplicated/recycled/
  // toMarkReturned vacíos, sin importar el historial.
  // Ver docs/superpowers/specs/2026-09-04-consolidado-upload-no-package-rules-design.md
  // ===========================================================================
  describe('classifyMasterRows — inserta todo, sin reglas de paquete', () => {
    const RET = ['devuelto_a_fedex'];

    it('mete TODAS las filas en toInsert, aunque existan (mismo u otro cons)', () => {
      const rows: CanonicalRow[] = [
        { trackingNumber: 'A' }, // nueva
        { trackingNumber: 'B' }, // existía en ESTE cons (antes: duplicada)
        { trackingNumber: 'C' }, // existía en OTRO cons (antes: reingreso)
        { trackingNumber: 'D' }, // existía en OTRO cons, ya devuelta
      ];
      const existing = new Map<string, { consolidatedId: string | null; status: string }>([
        ['B', { consolidatedId: 'CONS1', status: 'pendiente' }],
        ['C', { consolidatedId: 'CONS0', status: 'pendiente' }],
        ['D', { consolidatedId: 'CONS0', status: 'devuelto_a_fedex' }],
      ]);

      const r = classifyMasterRows(rows, existing, 'CONS1', RET);

      expect(r.toInsert.map((x) => x.trackingNumber)).toEqual(['A', 'B', 'C', 'D']);
      expect(r.duplicated).toEqual([]);
      expect(r.recycledTrackings).toEqual([]);
      expect(r.toMarkReturned).toEqual([]); // nunca se marca la vieja
    });

    it('cero chequeos: una guía repetida dentro del pegado se inserta las veces que aparezca', () => {
      const rows: CanonicalRow[] = [{ trackingNumber: 'X' }, { trackingNumber: 'X' }];

      const r = classifyMasterRows(rows, new Map(), 'CONS_ACTUAL', RET);

      expect(r.toInsert.map((x) => x.trackingNumber)).toEqual(['X', 'X']);
      expect(r.duplicated).toEqual([]);
    });

    it('misma guía en el MISMO consolidado ya NO se omite: también se inserta', () => {
      const rows: CanonicalRow[] = [{ trackingNumber: '876398883138' }];
      const existing = new Map([
        ['876398883138', { consolidatedId: 'CONS_ACTUAL', status: 'direccion_incorrecta' }],
      ]);

      const r = classifyMasterRows(rows, existing, 'CONS_ACTUAL', RET);

      expect(r.toInsert.map((x) => x.trackingNumber)).toEqual(['876398883138']);
      expect(r.duplicated).toEqual([]);
      expect(r.recycledTrackings).toEqual([]);
      expect(r.toMarkReturned).toEqual([]);
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
