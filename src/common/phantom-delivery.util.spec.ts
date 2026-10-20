import { isPhantomDelivery, onlyPhantomDeliveries, phantomDeliveryTimes, realDeliveryScan } from './phantom-delivery.util';

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

  // Caso REAL 521088534105 (Cabo, ruta 439565284120, 19-oct): entregada 14:36, FedEx manda el 67
  // con hora 15:26 (adelantada ~1 h) y su encabezado dice Delivered. Entregado es final.
  const cabo67 = [
    { date: '2026-10-19T21:05:57Z', eventType: 'IT', derivedStatusCode: 'IT' },
    { date: '2026-10-19T21:36:00Z', eventType: 'DL', derivedStatusCode: 'DL' },
    { date: '2026-10-19T22:26:00Z', eventType: 'IT', derivedStatusCode: 'IT', exceptionCode: '67' },
  ];

  it('un 67/44 posterior (escaneo nuestro) nunca anula la entrega', () => {
    expect(isPhantomDelivery(cabo67, cabo67[1])).toBe(false);
    expect(realDeliveryScan(cabo67)).toBe(cabo67[1]);
    expect(isPhantomDelivery([cabo67[1], { ...cabo67[2], exceptionCode: '44' }], cabo67[1])).toBe(false);
  });

  it('si el encabezado de FedEx dice Delivered, ninguna entrega es fantasma', () => {
    const header = { code: 'DL', derivedCode: 'DL' };
    expect(isPhantomDelivery(fantasma, fantasma[2], header)).toBe(false);
    expect(onlyPhantomDeliveries(fantasma, header)).toBe(false);
    expect(phantomDeliveryTimes(fantasma, header).size).toBe(0);
  });

  it('sin encabezado Delivered, el caso 383915660048 sigue siendo fantasma', () => {
    const header = { code: 'IT', derivedCode: 'IT' };
    expect(isPhantomDelivery(fantasma, fantasma[2], header)).toBe(true);
    expect(onlyPhantomDeliveries(fantasma, header)).toBe(true);
  });
});
