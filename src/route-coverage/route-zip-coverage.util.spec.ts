import { computeRouteZipShares, RouteZipRow } from './route-zip-coverage.util';

const row = (p: Partial<RouteZipRow>): RouteZipRow => ({
  routeId: 'r1',
  subsidiaryId: 's1',
  zip: '23400',
  city: 'CABO SAN LUCAS',
  weight: 1,
  firstSeen: new Date('2026-06-01T12:00:00Z'),
  lastSeen: new Date('2026-06-01T12:00:00Z'),
  ...p,
});

describe('computeRouteZipShares', () => {
  it('una sola ruta se lleva el 100% del CP', () => {
    const [r] = computeRouteZipShares([row({ weight: 10 })]);
    expect(r).toMatchObject({ routeId: 'r1', zip: '23400', shipmentCount: 10, share: 1 });
  });

  it('reparte el CP entre rutas de la misma sucursal según su peso', () => {
    const out = computeRouteZipShares([row({ routeId: 'r1', weight: 62 }), row({ routeId: 'r2', weight: 38 })]);
    expect(out.find((r) => r.routeId === 'r1')?.share).toBe(0.62);
    expect(out.find((r) => r.routeId === 'r2')?.share).toBe(0.38);
  });

  it('el mismo CP en otra sucursal no afecta la proporción', () => {
    const out = computeRouteZipShares([row({ routeId: 'r1', weight: 5 }), row({ routeId: 'x9', subsidiaryId: 's2', weight: 95 })]);
    expect(out.find((r) => r.routeId === 'r1')?.share).toBe(1);
    expect(out.find((r) => r.routeId === 'x9')?.share).toBe(1);
  });

  it('suma filas del mismo par, guarda fechas extremas y la ciudad más frecuente', () => {
    const [r] = computeRouteZipShares([
      row({ weight: 0.5, city: 'CSL', firstSeen: new Date('2026-05-01'), lastSeen: new Date('2026-05-01') }),
      row({ weight: 2, city: 'CABO SAN LUCAS', firstSeen: new Date('2026-07-01'), lastSeen: new Date('2026-09-01') }),
    ]);
    expect(r.shipmentCount).toBe(3);
    expect(r.city).toBe('CABO SAN LUCAS');
    expect(r.firstSeenAt?.toISOString().slice(0, 10)).toBe('2026-05-01');
    expect(r.lastSeenAt?.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('descarta CP inválidos (N/A, vacío) y pesos en cero', () => {
    expect(computeRouteZipShares([row({ zip: 'N/A' }), row({ zip: '' }), row({ zip: null }), row({ weight: 0 })])).toEqual([]);
  });

  it('normaliza CP con texto alrededor y cuenta mínimo 1 guía', () => {
    const [r] = computeRouteZipShares([row({ zip: 'CP 23410-1', weight: 0.2 })]);
    expect(r.zip).toBe('23410');
    expect(r.shipmentCount).toBe(1);
  });
});
