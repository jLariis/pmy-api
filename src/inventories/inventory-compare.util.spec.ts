import { diffInventories, inventoryGoneBucket, inventoryPackageKey } from './inventory-compare.util';

describe('inventory-compare.util', () => {
  it('la llave es la pieza DHL o la guía, en mayúsculas', () => {
    expect(inventoryPackageKey({ trackingNumber: '123', dhlUniqueId: 'jd0001' })).toBe('JD0001');
    expect(inventoryPackageKey({ trackingNumber: ' 7945 ' })).toBe('7945');
  });

  it('separa ya no están / aparecieron / siguen', () => {
    const prev = [
      { id: 'a', trackingNumber: '1', status: 'en_bodega' },
      { id: 'b', trackingNumber: '2', status: 'entregado', recipientName: 'Ana' },
      { id: 'c', trackingNumber: 'M', dhlUniqueId: 'JD1' },
    ];
    const curr = [
      { id: 'a2', trackingNumber: '1' },
      { id: 'd', trackingNumber: '3' },
      { id: 'c2', trackingNumber: 'M', dhlUniqueId: 'JD1' },
      { id: 'd2', trackingNumber: '3' }, // repetida: cuenta una vez
    ];
    const r = diffInventories(prev, curr);
    expect(r.keptKeys).toEqual(['1', 'JD1']);
    expect(r.appearedKeys).toEqual(['3']);
    expect(r.gone).toEqual([
      expect.objectContaining({ id: 'b', trackingNumber: '2', dhlUniqueId: null, recipientName: 'Ana', status: 'entregado', isCharge: false }),
    ]);
  });

  it('sin inventario anterior todo "aparece"', () => {
    const r = diffInventories([], [{ id: 'x', trackingNumber: '9' }]);
    expect(r).toEqual({ gone: [], appearedKeys: ['9'], keptKeys: [] });
  });
});

describe('inventoryGoneBucket', () => {
  it('POD, ruta y DEX por estatus de hoy', () => {
    expect(inventoryGoneBucket('entregado', false)).toBe('pod');
    expect(inventoryGoneBucket('ENTREGADO_EN_BODEGA', true)).toBe('pod');
    expect(inventoryGoneBucket('en_ruta', true)).toBe('ruta');
    expect(inventoryGoneBucket('en_transito', false)).toBe('ruta');
    expect(inventoryGoneBucket('cliente_no_disponible', true)).toBe('dex');
    expect(inventoryGoneBucket('rechazado', false)).toBe('dex');
  });

  it('en bodega: con movimiento = bodega, sin movimiento = sinMovimiento', () => {
    expect(inventoryGoneBucket('en_bodega', true)).toBe('bodega');
    expect(inventoryGoneBucket('en_bodega', false)).toBe('sinMovimiento');
    expect(inventoryGoneBucket('pendiente', false)).toBe('sinMovimiento');
    expect(inventoryGoneBucket(null, false)).toBe('sinMovimiento');
  });

  it('devuelta, ocurre o a cargo de FedEx = otros', () => {
    expect(inventoryGoneBucket('devuelto_a_fedex', false)).toBe('otros');
    expect(inventoryGoneBucket('es_ocurre', true)).toBe('otros');
    expect(inventoryGoneBucket('acargo_de_fedex', false)).toBe('otros');
  });
});
