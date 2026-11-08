import { buildSuggestions, commitBucket, latestPerPiece, pickRouteForZip, SuggestionPackage } from './route-suggestion.util';

// 7-nov-2026 10:00 hora local (UTC-7) = 17:00Z
const NOW = new Date('2026-11-07T17:00:00Z');

const pkg = (p: Partial<SuggestionPackage>): SuggestionPackage => ({
  id: p.trackingNumber ?? 't1',
  kind: 'shipment',
  trackingNumber: 't1',
  pieceKey: p.trackingNumber ?? 't1',
  scanCode: p.trackingNumber ?? 't1',
  zip: '23400',
  recipientName: 'X',
  recipientAddress: 'Calle 1',
  commitDateTime: new Date('2026-11-08T01:00:00Z'), // 7-nov 18:00 local → hoy
  status: 'en_bodega',
  carrier: 'fedex',
  createdAt: new Date('2026-11-05T17:00:00Z'),
  ...p,
});

describe('commitBucket', () => {
  it('usa el día local (UTC-7), no el UTC', () => {
    // 8-nov 01:00Z es 7-nov 18:00 local → hoy
    expect(commitBucket(new Date('2026-11-08T01:00:00Z'), NOW)).toBe('hoy');
    expect(commitBucket(new Date('2026-11-07T06:59:00Z'), NOW)).toBe('vencido'); // 6-nov 23:59 local
    expect(commitBucket(new Date('2026-11-08T07:00:00Z'), NOW)).toBe('manana');
    expect(commitBucket(new Date('2026-11-10T18:00:00Z'), NOW)).toBe('despues');
    expect(commitBucket(null, NOW)).toBe('sin_fecha');
  });
});

describe('pickRouteForZip', () => {
  it('prefiere la confirmada aunque tenga menos peso', () => {
    expect(
      pickRouteForZip([
        { routeId: 'a', share: 0.6, status: 'sugerido' },
        { routeId: 'b', share: 0.3, status: 'confirmado' },
      ]),
    ).toBe('b');
  });
  it('sin confirmadas toma la de más peso y nunca una excluida', () => {
    expect(
      pickRouteForZip([
        { routeId: 'a', share: 0.7, status: 'excluido' },
        { routeId: 'b', share: 0.2, status: 'sugerido' },
        { routeId: 'c', share: 0.1, status: 'sugerido' },
      ]),
    ).toBe('b');
    expect(pickRouteForZip([{ routeId: 'a', share: 1, status: 'excluido' }])).toBeNull();
    expect(pickRouteForZip(undefined)).toBeNull();
  });
});

describe('latestPerPiece', () => {
  it('vale el registro más reciente de la pieza y solo si sigue en bodega', () => {
    const out = latestPerPiece([
      pkg({ id: 'viejo', createdAt: new Date('2026-11-01'), status: 'en_bodega' }),
      pkg({ id: 'nuevo', createdAt: new Date('2026-11-06'), status: 'en_ruta' }),
      pkg({ id: 'otro', trackingNumber: 't2', pieceKey: 't2', status: 'cliente_no_disponible' }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['otro']);
  });
});

describe('buildSuggestions', () => {
  const routes = [
    { id: 'r1', name: 'CSL Centro' },
    { id: 'r2', name: 'Brisas' },
  ];
  const coverage = new Map([
    ['23400', [{ routeId: 'r1', share: 1, status: 'sugerido' as const }]],
    [
      '23450',
      [
        { routeId: 'r2', share: 0.62, status: 'sugerido' as const },
        { routeId: 'r1', share: 0.38, status: 'sugerido' as const },
      ],
    ],
  ]);

  it('agrupa por ruta, separa sin ruta y sin CP, y ordena por urgencia', () => {
    const r = buildSuggestions({
      packages: [
        pkg({ trackingNumber: 'a' }), // r1 hoy
        pkg({ trackingNumber: 'b', commitDateTime: new Date('2026-11-06T18:00:00Z') }), // r1 vencido
        pkg({ trackingNumber: 'c', zip: '23450', commitDateTime: new Date('2026-11-08T18:00:00Z') }), // r2 mañana
        pkg({ trackingNumber: 'd', zip: '23999' }), // sin ruta
        pkg({ trackingNumber: 'e', zip: 'N/A' }), // sin CP
        pkg({ trackingNumber: 'f', status: 'entregado' }), // fuera
      ],
      coverage,
      routes,
      dispatchInfo: new Map([['r1', { lastDispatchAt: new Date('2026-11-06T16:00:00Z'), openToday: 0 }]]),
      now: NOW,
    });
    expect(r.totals).toEqual({ total: 5, overdue: 1, today: 3, tomorrow: 1, routes: 2 });
    expect(r.routes.map((x) => x.routeId)).toEqual(['r1', 'r2']);
    expect(r.routes[0]).toMatchObject({ overdue: 1, today: 1, total: 2 });
    expect(r.routes[0].packages.map((p) => p.trackingNumber)).toEqual(['b', 'a']);
    expect(r.routes[1].packages[0].sharedWith).toEqual(['CSL Centro']);
    expect(r.routes[1].packages[0].sharedRouteIds).toEqual(['r1']);
    expect(r.routes[1].packages[0].scanCode).toBe('c');
    expect(r.routes[1].topZips[0]).toEqual({ zip: '23450', count: 1, shared: true });
    expect(r.unassigned.total).toBe(1);
    expect(r.noZip).toMatchObject({ total: 1, today: 1 });
  });

  it('ignora rutas inactivas aunque tengan cobertura', () => {
    const r = buildSuggestions({
      packages: [pkg({ trackingNumber: 'a', zip: '23450' })],
      coverage,
      routes: [{ id: 'r1', name: 'CSL Centro' }],
      dispatchInfo: new Map(),
      now: NOW,
    });
    expect(r.routes.map((x) => x.routeId)).toEqual(['r1']);
  });
});
