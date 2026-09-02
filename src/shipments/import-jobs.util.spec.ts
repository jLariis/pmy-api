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

  // ===========================================================================
  // REGRESIÓN — "faltó un paquete al pegar consolidado" (prod, sep-2026).
  //
  // Bug reproducido con datos reales (sucursal Cabo San Lucas): el dedup VIEJO
  // (existShipmentForSubsidiary) omitía toda guía ya existente cuyo último
  // estatus NO fuera de devolución, SIN mirar consolidado ni día. Así, una guía
  // que FedEx "volvió a dar" en un consolidado nuevo se caía solo porque quedó
  // registrada antes como `direccion_incorrecta` (u otro estatus activo).
  //
  // Regla correcta (la que estos tests BLINDAN): el reingreso se decide por
  // IDENTIDAD DE CONSOLIDADO, nunca por estatus. Como los números de consolidado
  // no se repiten entre días, "otro consolidado" ⟺ "otro día" ⟺ se recicla.
  // Si alguien reintroduce un filtro por estatus, estos tests truenan.
  // ===========================================================================
  describe('classifyMasterRows — regresión: el reingreso ignora el estatus', () => {
    const RET = ['devuelto_a_fedex'];

    // Estatus "activos" (no de devolución) que el bug viejo trataba como duplicado.
    const NON_RETURN_STATUSES = [
      'direccion_incorrecta', // ← el que tiró prod (guía 876398883138, CARLOS)
      'entregado',
      'pendiente',
      'en_bodega',
      'cliente_no_disponible',
      'rechazado',
    ];

    it.each(NON_RETURN_STATUSES)(
      'guía en OTRO consolidado con estatus "%s" se recicla (no se omite)',
      (status) => {
        const targetCons = 'CONS_NUEVO_02SEP';
        const rows: CanonicalRow[] = [{ trackingNumber: '876398883138' }];
        const existing = new Map([
          // existe solo en un consolidado anterior/distinto
          ['876398883138', { consolidatedId: 'CONS_31AGO', status }],
        ]);

        const r = classifyMasterRows(rows, existing, targetCons, RET);

        expect(r.toInsert.map((x) => x.trackingNumber)).toEqual(['876398883138']);
        expect(r.recycledTrackings).toEqual(['876398883138']);
        expect(r.duplicated).toEqual([]); // NUNCA debe caer como duplicado
      },
    );

    it('reproduce el consolidado CARLOS real: 2 reingresos, 0 omitidas', () => {
      const targetCons = 'CONS_305814055965'; // número nuevo (no existe aún)
      const rows: CanonicalRow[] = [
        { trackingNumber: '876398883138' }, // otro cons, direccion_incorrecta (31-ago)
        { trackingNumber: '383318424746' }, // otro cons, devuelto_a_fedex (28-ago)
        { trackingNumber: '876076374880' }, // 100% nueva
      ];
      const existing = new Map([
        ['876398883138', { consolidatedId: 'CONS_305811299721', status: 'direccion_incorrecta' }],
        ['383318424746', { consolidatedId: 'CONS_305811017120', status: 'devuelto_a_fedex' }],
      ]);

      const r = classifyMasterRows(rows, existing, targetCons, RET);

      // Las 3 se insertan: nada se omite (antes se caía 876398883138).
      expect(r.toInsert.map((x) => x.trackingNumber).sort()).toEqual(
        ['383318424746', '876076374880', '876398883138'],
      );
      expect(r.duplicated).toEqual([]);
      expect(r.recycledTrackings.sort()).toEqual(['383318424746', '876398883138']);
      // Solo la que NO estaba ya devuelta se re-marca como devuelta en el cons viejo.
      expect(r.toMarkReturned).toEqual(['876398883138']);
    });

    it('el dedup legítimo sigue vivo: misma guía en el MISMO consolidado se omite', () => {
      const targetCons = 'CONS_ACTUAL';
      const rows: CanonicalRow[] = [{ trackingNumber: '876398883138' }];
      const existing = new Map([
        ['876398883138', { consolidatedId: 'CONS_ACTUAL', status: 'direccion_incorrecta' }],
      ]);

      const r = classifyMasterRows(rows, existing, targetCons, RET);

      expect(r.duplicated.map((x) => x.trackingNumber)).toEqual(['876398883138']);
      expect(r.toInsert).toEqual([]);
      expect(r.recycledTrackings).toEqual([]);
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
