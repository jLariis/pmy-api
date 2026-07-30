import { splitShipmentIds, hydratePackageIds, resolvePackagePayment, formatPaymentDisplay } from './warehouse.helpers';

describe('splitShipmentIds', () => {
  it('separa normales y carga', () => {
    const res = splitShipmentIds([
      { id: 'a', isCharge: false },
      { id: 'b', isCharge: true },
      { id: 'c' },
    ]);
    expect(res.normalIds).toEqual(['a', 'c']);
    expect(res.chargeIds).toEqual(['b']);
  });

  it('maneja lista vacía', () => {
    expect(splitShipmentIds([])).toEqual({ normalIds: [], chargeIds: [] });
  });
});

describe('hydratePackageIds', () => {
  it('devuelve ids únicos', () => {
    expect(hydratePackageIds([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
  });
});

describe('resolvePackagePayment', () => {
  it('usa payment.amount y payment.type (relación hidratada)', () => {
    expect(resolvePackagePayment({ payment: { amount: 100, type: 'COD' } })).toEqual({ amount: 100, hasPayment: true, type: 'COD' });
  });

  it('cae a paymentAmount/paymentType cuando no hay relación payment', () => {
    expect(resolvePackagePayment({ paymentAmount: 75, paymentType: 'ROD' })).toEqual({ amount: 75, hasPayment: true, type: 'ROD' });
  });

  it('sin cobro -> amount null, hasPayment false, type null (sin importar isCharge)', () => {
    expect(resolvePackagePayment({})).toEqual({ amount: null, hasPayment: false, type: null });
  });

  it('el cobro NO depende de isCharge: envío normal con payment sí tiene cobro', () => {
    expect(resolvePackagePayment({ payment: { amount: 50, type: 'FTC' } } as any)).toEqual({ amount: 50, hasPayment: true, type: 'FTC' });
  });
});

describe('formatPaymentDisplay', () => {
  it('antepone el tipo al monto con 2 decimales', () => {
    expect(formatPaymentDisplay(1500, 'COD')).toBe('COD $1500.00');
    expect(formatPaymentDisplay(958.44, 'FTC')).toBe('FTC $958.44');
  });

  it('sin tipo -> solo monto formateado', () => {
    expect(formatPaymentDisplay(50, null)).toBe('$50.00');
    expect(formatPaymentDisplay(50)).toBe('$50.00');
  });

  it('sin monto -> "N/A"', () => {
    expect(formatPaymentDisplay(null, 'COD')).toBe('N/A');
    expect(formatPaymentDisplay(null)).toBe('N/A');
  });

  it('normaliza montos string de columnas decimal (TypeORM)', () => {
    expect(formatPaymentDisplay('1500' as any, 'COD')).toBe('COD $1500.00');
  });
});
