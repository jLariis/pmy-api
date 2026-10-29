import { applyClosureListHint, changedSinceClosure, closureBucket, displayCode, reconstructAtClosure, resolveClosureState } from './dispatch-overview.util';

const ev = (status: string, timestamp: string, createdAt: string, exceptionCode: string | null = null) => ({ status, timestamp, createdAt, exceptionCode });

describe('dispatch-overview.util', () => {
  it('agrupa estatus como el cierre', () => {
    expect(closureBucket('entregado_por_fedex')).toBe('entregado');
    expect(closureBucket('cliente_no_disponible')).toBe('no_entregado');
    expect(closureBucket('es_ocurre')).toBe('otro');
    expect(closureBucket(null)).toBe('otro');
  });

  it('el código solo se muestra en no entregados', () => {
    expect(displayCode('rechazado', '07')).toBe('07');
    expect(displayCode('en_bodega', '44')).toBeNull();
  });

  it('reconstruye con lo capturado hasta el cierre (no con eventos que llegaron después)', () => {
    const events = [
      ev('en_ruta', '2026-10-27T15:00:00Z', '2026-10-27T15:00:00Z'),
      ev('rechazado', '2026-10-27T20:00:00Z', '2026-10-27T21:00:00Z', '07'),
      // FedEx lo reportó al día siguiente con hora del 27: quien cerró no lo vio.
      ev('entregado', '2026-10-27T22:00:00Z', '2026-10-28T16:00:00Z'),
    ];
    expect(reconstructAtClosure(events, '2026-10-28T02:00:00Z')).toMatchObject({ status: 'rechazado', exceptionCode: '07' });
  });

  it('el estatus que escribe el propio cierre cuenta (margen de 2 min)', () => {
    const events = [ev('en_ruta', '2026-10-27T15:00:00Z', '2026-10-27T15:00:00Z'), ev('entregado', '2026-10-28T02:00:30Z', '2026-10-28T02:00:30Z')];
    expect(reconstructAtClosure(events, '2026-10-28T02:00:00Z')?.status).toBe('entregado');
  });

  it('prioridad: corregido > foto > reconstruido', () => {
    const snap = { status: 'entregado', exceptionCode: null };
    const rec = ev('rechazado', 'x', 'x', '07') as any;
    expect(resolveClosureState({ fix: { status: 'rechazado', exceptionCode: '07' }, snapshot: snap, reconstructed: rec })?.source).toBe('corregido');
    expect(resolveClosureState({ fix: { status: null, exceptionCode: null }, snapshot: snap, reconstructed: rec })?.source).toBe('foto');
    expect(resolveClosureState({ reconstructed: rec })?.source).toBe('reconstruido');
    expect(resolveClosureState({})).toBeNull();
  });

  it('cambió después del cierre', () => {
    expect(changedSinceClosure({ status: 'rechazado', exceptionCode: '07' }, { status: 'entregado', exceptionCode: null })).toBe(true);
    expect(changedSinceClosure({ status: 'rechazado', exceptionCode: '07' }, { status: 'rechazado', exceptionCode: '08' })).toBe(true);
    expect(changedSinceClosure({ status: 'entregado', exceptionCode: '44' }, { status: 'entregado', exceptionCode: null })).toBe(false);
    expect(changedSinceClosure({ status: 'rechazado', exceptionCode: '07' }, { status: 'devuelto_a_fedex', exceptionCode: '07' })).toBe(false);
    expect(changedSinceClosure({ status: 'en_ruta', exceptionCode: null }, { status: 'entregado', exceptionCode: null })).toBe(true);
    expect(changedSinceClosure(null, { status: 'entregado', exceptionCode: null })).toBe(false);
  });

  it('en cierres viejos manda la lista donde el cierre puso la guía', () => {
    const enRuta = ev('en_ruta', '2026-10-27T15:00:00Z', '2026-10-27T15:00:00Z');
    expect(applyClosureListHint(enRuta, 'pod')?.status).toBe('entregado');
    expect(applyClosureListHint(enRuta, 'returned')?.status).toBe('no_entregado');
    expect(applyClosureListHint(ev('rechazado', 'x', 'x', '07'), 'returned')).toMatchObject({ status: 'rechazado', exceptionCode: '07' });
    expect(applyClosureListHint(null, 'pod')?.status).toBe('entregado');
    expect(applyClosureListHint(enRuta, null)).toBe(enRuta);
  });
});
