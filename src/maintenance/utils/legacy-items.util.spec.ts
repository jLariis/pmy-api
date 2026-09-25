import { deriveLegacyRequestItems } from './legacy-items.util';

describe('deriveLegacyRequestItems', () => {
  it('agrupa partidas iguales entre cotizaciones (producto o descripción sin acentos/mayúsculas)', () => {
    const out = deriveLegacyRequestItems([
      { id: 'a1', quoteId: 'qA', productId: 's1', description: 'Cambio de aceite', quantity: 1, winner: false },
      { id: 'b1', quoteId: 'qB', productId: 's1', description: 'Cambio aceite', quantity: 1, winner: true },
      { id: 'a2', quoteId: 'qA', productId: null, description: 'Balatas delanteras', quantity: 1, winner: false },
      { id: 'b2', quoteId: 'qB', productId: null, description: ' balatas  DELANTERAS ', quantity: 2, winner: true },
      { id: 'b3', quoteId: 'qB', productId: null, description: 'Mano de obra', quantity: 1, winner: true },
    ]);
    expect(out.map((g) => [g.description, g.quoteItemIds, g.selectedQuoteItemId, g.quantity])).toEqual([
      ['Cambio de aceite', ['a1', 'b1'], 'b1', 1],
      ['Balatas delanteras', ['a2', 'b2'], 'b2', 2],
      ['Mano de obra', ['b3'], 'b3', 1],
    ]);
  });

  it('si una cotización repite un concepto, la repetida va en su propio renglón', () => {
    const out = deriveLegacyRequestItems([
      { id: 'a1', quoteId: 'qA', productId: null, description: 'Llanta', quantity: 2, winner: false },
      { id: 'a2', quoteId: 'qA', productId: null, description: 'Llanta', quantity: 2, winner: false },
    ]);
    expect(out.map((g) => g.quoteItemIds)).toEqual([['a1'], ['a2']]);
  });
});
