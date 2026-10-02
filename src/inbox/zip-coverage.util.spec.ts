import { cleanZip, computeZipShares, uploadMinutes } from './zip-coverage.util';

describe('zip-coverage.util', () => {
  it('limpia CP', () => {
    expect(cleanZip(' 83600 ')).toBe('83600');
    expect(cleanZip(8360)).toBe('08360');
    expect(cleanZip('C.P. 23450')).toBe('23450');
    expect(cleanZip('')).toBeNull();
    expect(cleanZip('00000')).toBeNull();
  });

  it('proporción por CP y ciudad más frecuente; CP compartido queda 50/50', () => {
    const r = computeZipShares([
      { zip: '83600', subsidiaryId: 'caborca', city: 'CABORCA', n: 98 },
      { zip: '83600', subsidiaryId: 'caborca', city: 'H CABORCA', n: 2 },
      { zip: '83000', subsidiaryId: 'hmo', city: 'HERMOSILLO', n: 50 },
      { zip: '83000', subsidiaryId: 'bhmo', city: 'HERMOSILLO', n: 50 },
      { zip: 'xx', subsidiaryId: 'hmo', city: null, n: 5 },
    ]);
    const cab = r.find((x) => x.zip === '83600')!;
    expect(cab).toMatchObject({ subsidiaryId: 'caborca', shipmentCount: 100, share: 1, city: 'CABORCA' });
    const shared = r.filter((x) => x.zip === '83000');
    expect(shared.map((x) => x.share)).toEqual([0.5, 0.5]);
    expect(r).toHaveLength(3);
  });

  it('minutos de subida', () => {
    const a = new Date('2026-10-01T19:32:00Z');
    expect(uploadMinutes(a, new Date('2026-10-01T19:47:30Z'))).toBe(16);
    expect(uploadMinutes(a, new Date('2026-10-01T19:00:00Z'))).toBe(0);
  });
});
