import { sortForDispatch, subsidiaryDispatchSortMode, dispatchCarrier } from './dispatch-sort.util';

const p = (id: string, shipmentType: string, recipientZip: string, recipientAddress = '', isCharge = false) =>
  ({ id, shipmentType, recipientZip, recipientAddress, isCharge });

describe('dispatch-sort.util', () => {
  const items = [
    p('dhl-85000', 'dhl', '85000', 'B'),
    p('fx-85100', 'fedex', '85100'),
    p('f2-85010', '', '85010', '', true),
    p('fx-85000-b', 'fedex', '85000', 'Calle B'),
    p('fx-85000-a', 'fedex', '85000', 'Calle A'),
    p('dhl-sincp', 'dhl', ''),
    p('dhl-84000', 'dhl', '84000'),
  ];

  it('carrier_cp: FedEx (con F2) primero por CP y dirección, luego DHL por CP; sin CP al final del grupo', () => {
    expect(sortForDispatch(items, 'carrier_cp').map((x) => x.id)).toEqual([
      'fx-85000-a', 'fx-85000-b', 'f2-85010', 'fx-85100', 'dhl-84000', 'dhl-85000', 'dhl-sincp',
    ]);
  });

  it('cp: mezcla paqueterías por CP', () => {
    expect(sortForDispatch(items, 'cp').map((x) => x.id).slice(0, 3)).toEqual(['dhl-84000', 'dhl-85000', 'fx-85000-a']);
  });

  it('scan: conserva el orden y no muta', () => {
    const out = sortForDispatch(items, 'scan');
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it('la F2 cuenta como FedEx', () => {
    expect(dispatchCarrier({ isCharge: true })).toBe('fedex');
  });

  it('modo por sucursal: paquetería manda sobre CP', () => {
    expect(subsidiaryDispatchSortMode({ sortDispatchByCarrier: true, sortDispatchByPostalCode: false })).toBe('carrier_cp');
    expect(subsidiaryDispatchSortMode({ sortDispatchByPostalCode: true })).toBe('cp');
    expect(subsidiaryDispatchSortMode(null)).toBe('scan');
  });
});

describe('orden por ciudad (Bodega)', () => {
  const c = (id: string, city: string | null, zip: string, shipmentType = 'fedex', zoneCity?: string) =>
    ({ id, recipientCity: city, recipientZip: zip, shipmentType, zoneCity });
  it('ciudad A→Z, sin ciudad al final, luego CP y paquetería', () => {
    const out = sortForDispatch([
      c('sin', null, '85000'),
      c('nav-dhl', 'Navojoa', '85800', 'dhl'),
      c('alamos', 'Alamos', '85760'),
      c('nav-fx', 'Navojoa', '85800'),
      c('bodega', 'BODEGA OBREGON', '85000', 'dhl'),
    ], 'city');
    expect(out.map((x) => x.id)).toEqual(['alamos', 'nav-fx', 'nav-dhl', 'sin', 'bodega']);
  });
  it('la ciudad de la memoria de CP manda sobre la de la guía', () => {
    const out = sortForDispatch([c('b', 'Zona', '1', 'fedex', 'Alamos'), c('a', 'Bacum', '1')], 'city');
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

