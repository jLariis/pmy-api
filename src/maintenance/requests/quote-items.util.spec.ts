import { buildQuoteItems } from './quote-items.util';

describe('buildQuoteItems', () => {
  it('calcula importes, snapshot de referencia, desviación y totales', () => {
    const r = buildQuoteItems(
      [
        { serviceId: 's1', description: ' Cambio de aceite ', quantity: 1, unitPrice: 1150 },
        { serviceId: null, description: 'Filtro', quantity: 2, unitPrice: 100, taxRate: 0 },
      ],
      new Map([['s1', 1000]]),
    );
    expect(r.items[0]).toMatchObject({ description: 'Cambio de aceite', amount: 1150, referencePrice: 1000, deviationPct: 15, taxRate: 0.16 });
    expect(r.items[1]).toMatchObject({ serviceId: null, amount: 200, referencePrice: null, deviationPct: null });
    expect({ subtotal: r.subtotal, tax: r.tax, total: r.total }).toEqual({ subtotal: 1350, tax: 184, total: 1534 });
  });
});
