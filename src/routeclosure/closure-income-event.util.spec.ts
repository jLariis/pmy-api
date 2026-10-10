import { selectClosureIncomeEvent } from './closure-income-event.util';

// Caso real Loreto: ruta 152171165233 (06-oct), guía 383934388357 entregada 07-oct 17:40Z.
const history = [
  { status: 'pendiente', timestamp: '2026-10-05T06:26:26Z', exceptionCode: 'INIT', notes: 'Registro inicial' },
  { status: 'en_ruta', timestamp: '2026-10-06T19:33:37Z', exceptionCode: '', notes: 'Salida a ruta (Folio Despacho: x)' },
  { status: 'en_bodega', timestamp: '2026-10-07T16:37:00Z', exceptionCode: '67', notes: 'On the way' },
  { status: 'entregado', timestamp: '2026-10-07T17:40:00Z', exceptionCode: '', notes: 'Delivered' },
];

describe('selectClosureIncomeEvent', () => {
  it('toma la hora EXACTA de la entrega aunque sea del día siguiente a la ruta', () => {
    const ev = selectClosureIncomeEvent({ history, status: 'entregado', routeDay: '2026-10-06', windowEnd: null });
    expect(ev?.occurredAt.toISOString()).toBe('2026-10-07T17:40:00.000Z');
  });

  it('sin evento del estatus cobrado no devuelve nada (no inventa fecha)', () => {
    const ev = selectClosureIncomeEvent({ history, status: 'rechazado', routeDay: '2026-10-06', windowEnd: null });
    expect(ev).toBeNull();
  });

  it('ignora eventos anteriores al día de la ruta', () => {
    const old = [{ status: 'entregado', timestamp: '2026-10-02T18:00:00Z', exceptionCode: '' }];
    expect(selectClosureIncomeEvent({ history: old, status: 'entregado', routeDay: '2026-10-06', windowEnd: null })).toBeNull();
  });

  it('ignora lo que pasó después de que la guía salió en otra ruta', () => {
    const ev = selectClosureIncomeEvent({
      history, status: 'entregado', routeDay: '2026-10-06', windowEnd: new Date('2026-10-07T15:00:00Z'),
    });
    expect(ev).toBeNull();
  });

  it('ignora filas internas aunque tengan el estatus', () => {
    const internal = [{ status: 'entregado', timestamp: '2026-10-06T20:00:00Z', exceptionCode: 'INIT' }];
    expect(selectClosureIncomeEvent({ history: internal, status: 'entregado', routeDay: '2026-10-06', windowEnd: null })).toBeNull();
  });

  it('DEX: prefiere las filas con el código esperado y regresa su código', () => {
    const dex = [
      { status: 'rechazado', timestamp: '2026-10-07T18:00:00Z', exceptionCode: '07' },
      { status: 'rechazado', timestamp: '2026-10-07T19:00:00Z', exceptionCode: '' },
    ];
    const ev = selectClosureIncomeEvent({ history: dex, status: 'rechazado', exceptionCode: '07', routeDay: '2026-10-06', windowEnd: null });
    expect(ev).toEqual({ occurredAt: new Date('2026-10-07T18:00:00Z'), exceptionCode: '07' });
  });
});
