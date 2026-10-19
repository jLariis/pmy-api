import {
  buildCarrierEvents,
  buildQueryVariants,
  isInternalStatusNote,
  pieceKey,
  sortInternalEvents,
  userLabel,
} from './package-dossier.util';

describe('package-dossier.util', () => {
  it('limpia la búsqueda y agrega la pareja JJD↔JD', () => {
    expect(buildQueryVariants(' 7712 3456 ')).toEqual(['77123456']);
    expect(buildQueryVariants('jd0146')).toEqual(['JD0146', 'JJD0146']);
    expect(buildQueryVariants('JJD0146')).toEqual(['JJD0146', 'JD0146']);
    expect(buildQueryVariants('')).toEqual([]);
  });

  it('reconoce las notas que escribe el sistema', () => {
    expect(isInternalStatusNote('Registro inicial. Cons: 123')).toBe(true);
    expect(isInternalStatusNote('Salida a ruta (Folio Despacho: abc)')).toBe(true);
    expect(isInternalStatusNote('Paquete F2 confirmado en inventario físico (Folio Inv: 1)')).toBe(true);
    expect(isInternalStatusNote('Ingreso a bodega mediante desembarque (Folio: X)')).toBe(true);
    expect(isInternalStatusNote('Devolución registrada en sucursal: X. Motivo: 14')).toBe(true);
    expect(isInternalStatusNote('DL - Delivered')).toBe(false);
    expect(isInternalStatusNote(null)).toBe(false);
  });

  it('el historial FedEx/DHL excluye las filas internas y va del más reciente al más viejo', () => {
    const events = buildCarrierEvents([
      { status: 'pendiente', notes: 'Registro inicial', timestamp: '2026-10-14T08:00:00Z' },
      { status: 'en_ruta', notes: 'OD - On FedEx vehicle', exceptionCode: '', timestamp: '2026-10-15T09:00:00Z' },
      { status: 'no_entregado', notes: 'DEX - Customer not available', exceptionCode: '03', timestamp: '2026-10-15T14:00:00Z' },
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ status: 'no_entregado', code: '03' });
    expect(events[1]).toMatchObject({ status: 'en_ruta', code: null });
  });

  it('ordena los movimientos internos del más viejo al más reciente, sin fecha al final', () => {
    const sorted = sortInternalEvents([
      { kind: 'ingreso', date: null, title: 'Ingreso', detail: null, tag: null, tone: 'neutral' },
      { kind: 'salida_ruta', date: '2026-10-15T09:00:00.000Z', title: 'Salida', detail: null, tag: null, tone: 'info' },
      { kind: 'registro', date: '2026-10-14T08:00:00.000Z', title: 'Registro', detail: null, tag: null, tone: 'neutral' },
    ]);
    expect(sorted.map((e) => e.kind)).toEqual(['registro', 'salida_ruta', 'ingreso']);
  });

  it('arma nombre de usuario y clave de pieza', () => {
    expect(userLabel({ name: 'Ana', lastName: 'Ruiz' })).toBe('Ana Ruiz');
    expect(userLabel({ email: 'a@b.c' })).toBe('a@b.c');
    expect(userLabel(null)).toBeNull();
    expect(pieceKey({ trackingNumber: '1234567890', dhlUniqueId: 'JD01' })).toBe('JD01');
    expect(pieceKey({ trackingNumber: '7712' })).toBe('7712');
  });
});
