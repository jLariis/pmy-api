import { availabilityLabel, taxLabel } from './labels.util';

describe('labels.util', () => {
  it('taxLabel', () => {
    expect(taxLabel({ quantity: 1, unitPrice: 1, ivaEnabled: true })).toBe('IVA');
    expect(taxLabel({ quantity: 1, unitPrice: 1, ivaEnabled: true, iepsEnabled: true, iepsRate: 0.265 })).toBe('IVA + IEPS 26.5%');
    expect(taxLabel({ quantity: 1, unitPrice: 1, ivaEnabled: false })).toBe('Sin impuestos');
    expect(taxLabel({ quantity: 1, unitPrice: 1, taxRate: 0.16 })).toBe('IVA');
  });

  it('availabilityLabel', () => {
    expect(availabilityLabel('si')).toBe('En existencia');
    expect(availabilityLabel('sobre_pedido', 3)).toBe('Sobre pedido (3 días)');
    expect(availabilityLabel(null)).toBe('');
  });
});
