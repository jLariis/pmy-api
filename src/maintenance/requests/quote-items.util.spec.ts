import { buildQuoteItems } from './quote-items.util';

describe('buildQuoteItems (v3)', () => {
  it('importes, impuestos por partida, existencia y desviación', () => {
    const r = buildQuoteItems(
      [
        { requestItemId: 'ri1', productId: 'p1', description: ' Aceite ', quantity: 1, unitPrice: 1150, iepsEnabled: true, iepsRate: 0.08 },
        { requestItemId: 'ri2', description: 'Filtro', quantity: 2, unitPrice: 100, ivaEnabled: false, availability: 'sobre_pedido', leadTimeDays: 3 },
        { description: 'Otro', quantity: 1, unitPrice: 10, availability: 'no', leadTimeDays: 9 },
      ],
      new Map([['p1', 1000]]),
    );
    expect(r.items[0]).toMatchObject({ requestItemId: 'ri1', description: 'Aceite', amount: 1150, iepsEnabled: true, iepsRate: 0.08, deviationPct: 15, availability: 'si' });
    expect(r.items[1]).toMatchObject({ ivaEnabled: false, taxRate: 0, availability: 'sobre_pedido', leadTimeDays: 3 });
    expect(r.items[2].leadTimeDays).toBeNull();
    // IEPS 92; IVA (1150+92)*.16=198.72 + (10)*.16=1.6 → 200.32
    expect({ subtotal: r.subtotal, ieps: r.ieps, tax: r.tax, total: r.total }).toEqual({ subtotal: 1360, ieps: 92, tax: 200.32, total: 1652.32 });
  });
});
