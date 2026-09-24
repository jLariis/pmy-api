import { totals, deviationPct, itemAmount } from './money.util';

describe('money', () => {
  const items = [{ quantity: 2, unitPrice: 100, approved: true }, { quantity: 1, unitPrice: 50.5, taxRate: 0, approved: false }];
  it('itemAmount', () => expect(itemAmount({ quantity: 3, unitPrice: 10.25 })).toBe(30.75));
  it('totales todas', () => expect(totals(items)).toEqual({ subtotal: 250.5, tax: 32, total: 282.5 }));
  it('solo aprobadas', () => expect(totals(items, true)).toEqual({ subtotal: 200, tax: 32, total: 232 }));
  it('desviación', () => {
    expect(deviationPct(1150, 1000)).toBe(15);
    expect(deviationPct(900, 1000)).toBe(-10);
    expect(deviationPct(900, null)).toBeNull();
  });
});
