import { lastPlausibleKms, pickDispatchDefaults, RecentDispatch } from './dispatch-defaults.util';

const d = (i: number, driverIds: string[], vehicleId: string | null): RecentDispatch => ({
  dispatchId: `d${i}`,
  createdAt: new Date(Date.UTC(2026, 10, 7 - i)),
  driverIds,
  vehicleId,
});

describe('pickDispatchDefaults', () => {
  it('sugiere el repartidor que más se repite y la unidad que él usa', () => {
    const r = pickDispatchDefaults([d(0, ['ana'], 'v1'), d(1, ['ana'], 'v1'), d(2, ['beto'], 'v2'), d(3, ['beto'], 'v2'), d(4, ['ana'], 'v2')]);
    expect(r.driverIds).toEqual(['ana']);
    expect(r.vehicleId).toBe('v1');
    expect(r.driverHits).toBe(3);
  });

  it('en empate gana el que salió más recientemente', () => {
    const r = pickDispatchDefaults([d(0, ['beto'], 'v2'), d(1, ['ana'], 'v1'), d(2, ['ana'], 'v1'), d(3, ['beto'], 'v2')]);
    expect(r.driverIds).toEqual(['beto']);
  });

  it('no sugiere nada si no hay patrón (todo aparece una vez)', () => {
    const r = pickDispatchDefaults([d(0, ['ana'], 'v1'), d(1, ['beto'], 'v2')]);
    expect(r).toMatchObject({ driverIds: [], vehicleId: null, sample: 2 });
  });

  it('solo mira las últimas salidas', () => {
    const old = Array.from({ length: 6 }, (_, i) => d(10 + i, ['viejo'], 'v9'));
    const r = pickDispatchDefaults([d(0, ['ana'], 'v1'), d(1, ['ana'], 'v1'), ...old], 2);
    expect(r.driverIds).toEqual(['ana']);
  });
});

describe('lastPlausibleKms', () => {
  it('ignora capturas de relleno y toma el mayor', () => {
    expect(lastPlausibleKms(['1', '00000', '84,210', 84100, null, 'abc'])).toBe(84210);
    expect(lastPlausibleKms(['1', '0', undefined])).toBeNull();
  });
});
