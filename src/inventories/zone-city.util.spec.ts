import { buildZipCityMap, normalizeCity, resolveZoneCity } from './zone-city.util';

describe('zone-city.util', () => {
  it('normaliza y descarta ciudades basura', () => {
    expect(normalizeCity('  cd.  obregon ')).toBe('CD. OBREGON');
    expect(normalizeCity('N/A')).toBeNull();
    expect(normalizeCity(null)).toBeNull();
    expect(normalizeCity('Bodega Obregon')).toBeNull();
  });

  it('si la fila de la sucursal trae "BODEGA ...", usa la siguiente ciudad real del CP', () => {
    const map = buildZipCityMap(
      [
        { zip: '85204', city: 'BODEGA OBREGON', subsidiaryId: 'obr', share: '0.94', status: 'sugerido' },
        { zip: '85204', city: 'VILLA JUAREZ', subsidiaryId: 'vj', share: '0.05', status: 'sugerido' },
      ],
      'obr',
    );
    expect(map.get('85204')).toBe('VILLA JUAREZ');
  });

  it('prefiere la fila de la sucursal del inventario sobre la de mayor proporción', () => {
    const map = buildZipCityMap(
      [
        { zip: '85160', city: 'CAJEME', subsidiaryId: 'otra', share: '0.9', status: 'sugerido' },
        { zip: '85160', city: 'ESPERANZA', subsidiaryId: 'mia', share: '0.1', status: 'sugerido' },
      ],
      'mia',
    );
    expect(map.get('85160')).toBe('ESPERANZA');
  });

  it('ignora excluidas y sin ciudad; si no, gana la mayor proporción', () => {
    const map = buildZipCityMap([
      { zip: '23000', city: 'LA PAZ', subsidiaryId: 'a', share: '0.2', status: 'sugerido' },
      { zip: '23000', city: 'EL CENTENARIO', subsidiaryId: 'b', share: '0.8', status: 'sugerido' },
      { zip: '23000', city: 'OTRA', subsidiaryId: 'c', share: '1', status: 'excluido' },
      { zip: '23590', city: 'N/A', subsidiaryId: 'a', share: '1', status: 'sugerido' },
    ]);
    expect(map.get('23000')).toBe('EL CENTENARIO');
    expect(map.has('23590')).toBe(false);
  });

  it('cae a la ciudad de la guía cuando el CP no está en la memoria', () => {
    const map = new Map([['83000', 'HERMOSILLO']]);
    expect(resolveZoneCity({ recipientZip: '83000', recipientCity: 'hmo' }, map)).toBe('HERMOSILLO');
    expect(resolveZoneCity({ recipientZip: '99999', recipientCity: 'guaymas' }, map)).toBe('GUAYMAS');
    expect(resolveZoneCity({ recipientZip: null, recipientCity: '' }, map)).toBeNull();
  });
});
