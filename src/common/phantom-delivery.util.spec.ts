import { isPhantomDelivery, onlyPhantomDeliveries, realDeliveryScan } from './phantom-delivery.util';

// Historial REAL de 383915660048 (horas UTC).
const fantasma = [
  { date: '2026-09-28T17:47:00Z', eventType: 'OC' },
  { date: '2026-09-30T18:07:00Z', eventType: 'PU', derivedStatusCode: 'PU' },
  { date: '2026-09-30T23:56:00Z', eventType: 'DL', derivedStatusCode: 'DL' }, // "entrega" a mitad del trayecto
  { date: '2026-10-01T05:40:00Z', eventType: 'DP', derivedStatusCode: 'IT' },
  { date: '2026-10-01T07:16:00Z', eventType: 'AR', derivedStatusCode: 'IT' },
  { date: '2026-10-03T20:44:00Z', eventType: 'AR' },
];

describe('entrega fantasma', () => {
  it('CASO 383915660048: DL seguido de salida/llegada es fantasma; no hay entrega real', () => {
    expect(isPhantomDelivery(fantasma, fantasma[2])).toBe(true);
    expect(realDeliveryScan(fantasma)).toBeNull();
    expect(onlyPhantomDeliveries(fantasma)).toBe(true);
  });

  it('entrega real (nada de movimiento después) sí cuenta', () => {
    const real = [
      { date: '2026-10-03T15:21:00Z', eventType: 'OD', derivedStatusCode: 'OD' },
      { date: '2026-10-03T19:16:00Z', eventType: 'DL', derivedStatusCode: 'DL' },
    ];
    expect(realDeliveryScan(real)?.date).toBe('2026-10-03T19:16:00Z');
    expect(onlyPhantomDeliveries(real)).toBe(false);
  });

  it('fantasma y después entrega real: toma la real', () => {
    const ev = [...fantasma, { date: '2026-10-05T19:00:00Z', eventType: 'OD' }, { date: '2026-10-05T21:00:00Z', eventType: 'DL' }];
    expect(realDeliveryScan(ev)?.date).toBe('2026-10-05T21:00:00Z');
    expect(onlyPhantomDeliveries(ev)).toBe(false);
  });

  it('un evento posterior que NO es movimiento (ej. código 67, sin tipo) no anula la entrega', () => {
    const ev = [
      { date: '2026-10-03T19:16:00Z', eventType: 'DL' },
      { date: '2026-10-03T20:00:00Z', eventType: 'OC' },
    ];
    expect(realDeliveryScan(ev)).not.toBeNull();
  });

  it('sin entregas → null y no "solo fantasmas"', () => {
    expect(realDeliveryScan([{ date: '2026-10-03T19:16:00Z', eventType: 'AR' }])).toBeNull();
    expect(onlyPhantomDeliveries([{ date: '2026-10-03T19:16:00Z', eventType: 'AR' }])).toBe(false);
  });
});
