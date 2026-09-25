import { compareByItem, groupSelectionBySupplier } from './comparison.util';

const reqItems = [
  { id: 'ri1', description: 'Aceite 10W-30', productId: 'p1', quantity: 5, selectedQuoteItemId: null },
  { id: 'ri2', description: 'Balero doble', productId: null, quantity: 2, selectedQuoteItemId: null },
  { id: 'ri3', description: 'Tapete', productId: null, quantity: 1, selectedQuoteItemId: null },
];
const quotes = [
  {
    id: 'qA', supplierId: 'sA', supplierName: 'AutoZone', items: [
      { id: 'a1', requestItemId: 'ri1', productId: 'p1', description: 'Aceite', quantity: 5, unitPrice: 60, availability: 'si', quality: 5 },
      { id: 'a2', requestItemId: 'ri2', description: 'Balero', quantity: 2, unitPrice: 500, availability: 'no', quality: 2 },
    ],
  },
  {
    id: 'qB', supplierId: 'sB', supplierName: 'Orealli', items: [
      { id: 'b1', requestItemId: null, productId: 'p1', description: 'Aceite', quantity: 5, unitPrice: 70, availability: 'si' },
      { id: 'b2', requestItemId: null, description: '  balero DOBLE ', quantity: 2, unitPrice: 600, availability: 'sobre_pedido', leadTimeDays: 3 },
    ],
  },
] as any;

describe('compareByItem', () => {
  const c = compareByItem(reqItems as any, quotes);

  it('empata partidas por renglón, luego por producto, luego por descripción', () => {
    expect(c.rows[0].cells.qA?.quoteItemId).toBe('a1');
    expect(c.rows[0].cells.qB?.quoteItemId).toBe('b1'); // por productId
    expect(c.rows[1].cells.qB?.quoteItemId).toBe('b2'); // por descripción normalizada
    expect(c.rows[2].cells).toEqual({});
  });

  it('mejor precio por renglón: ignora sin existencia; si nadie tiene, el más barato', () => {
    expect(c.rows[0].bestQuoteItemId).toBe('a1');
    expect(c.rows[1].bestQuoteItemId).toBe('b2'); // AutoZone es más barato pero no tiene
    expect(c.rows[2].bestQuoteItemId).toBeNull();
  });

  it('propone el mejor si no hay elección guardada', () => {
    expect(c.rows[0].selectedQuoteItemId).toBe('a1');
    expect(c.rows[1].selectedQuoteItemId).toBe('b2');
  });

  it('respeta la elección guardada', () => {
    const c2 = compareByItem([{ ...reqItems[0], selectedQuoteItemId: 'b1' }] as any, quotes);
    expect(c2.rows[0].selectedQuoteItemId).toBe('b1');
    expect(c2.rows[0].bestQuoteItemId).toBe('a1');
  });

  it('agrupa lo elegido por proveedor (una orden por proveedor)', () => {
    const g = groupSelectionBySupplier(c, quotes);
    expect(g.map((x) => [x.supplierId, x.quoteItemIds])).toEqual([['sA', ['a1']], ['sB', ['b2']]]);
  });
});
