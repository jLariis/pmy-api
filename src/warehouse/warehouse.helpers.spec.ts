import { splitShipmentIds, hydratePackageIds } from './warehouse.helpers';

describe('splitShipmentIds', () => {
  it('separa normales y carga', () => {
    const res = splitShipmentIds([
      { id: 'a', isCharge: false },
      { id: 'b', isCharge: true },
      { id: 'c' },
    ]);
    expect(res.normalIds).toEqual(['a', 'c']);
    expect(res.chargeIds).toEqual(['b']);
  });

  it('maneja lista vacía', () => {
    expect(splitShipmentIds([])).toEqual({ normalIds: [], chargeIds: [] });
  });
});

describe('hydratePackageIds', () => {
  it('devuelve ids únicos', () => {
    expect(hydratePackageIds([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
  });
});
