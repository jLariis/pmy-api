import { deviationPct, itemAmount, lineTaxes, totals } from './money.util';

describe('money (IVA/IEPS por partida)', () => {
  it('itemAmount', () => expect(itemAmount({ quantity: 3, unitPrice: 10.25 })).toBe(30.75));

  it('línea con IVA (default) sin IEPS', () =>
    expect(lineTaxes({ quantity: 2, unitPrice: 100 })).toEqual({ amount: 200, ieps: 0, iva: 32, total: 232 }));

  it('línea con IEPS 8% y IVA: IVA se calcula sobre importe + IEPS', () =>
    expect(lineTaxes({ quantity: 1, unitPrice: 100, ivaEnabled: true, iepsEnabled: true, iepsRate: 0.08 })).toEqual({ amount: 100, ieps: 8, iva: 17.28, total: 125.28 }));

  it('línea sin IVA', () => expect(lineTaxes({ quantity: 1, unitPrice: 50, ivaEnabled: false })).toEqual({ amount: 50, ieps: 0, iva: 0, total: 50 }));

  it('IEPS apagado ignora la tasa', () => expect(lineTaxes({ quantity: 1, unitPrice: 100, iepsEnabled: false, iepsRate: 0.53 }).ieps).toBe(0));

  it('compat: taxRate=0 equivale a sin IVA', () => expect(lineTaxes({ quantity: 1, unitPrice: 50, taxRate: 0 }).iva).toBe(0));

  it('totales (todas y solo aprobadas)', () => {
    const items = [
      { quantity: 2, unitPrice: 100, approved: true },
      { quantity: 1, unitPrice: 100, iepsEnabled: true, iepsRate: 0.08, approved: false },
    ];
    expect(totals(items)).toEqual({ subtotal: 300, ieps: 8, tax: 49.28, total: 357.28 });
    expect(totals(items, true)).toEqual({ subtotal: 200, ieps: 0, tax: 32, total: 232 });
  });

  it('desviación', () => {
    expect(deviationPct(1150, 1000)).toBe(15);
    expect(deviationPct(900, null)).toBeNull();
  });
});
