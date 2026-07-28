import { splitShipmentIds, hydratePackageIds, resolvePackagePayment } from './warehouse.helpers';

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
  it('usa payment.amount (relación hidratada)', () => {
    expect(resolvePackagePayment({ payment: { amount: 100 } })).toEqual({ amount: 100, hasPayment: true });
  });

  it('cae a paymentAmount cuando no hay payment.amount', () => {
    expect(resolvePackagePayment({ paymentAmount: 75 })).toEqual({ amount: 75, hasPayment: true });
  });

  it('sin cobro -> amount null, hasPayment false (sin importar isCharge)', () => {
    expect(resolvePackagePayment({})).toEqual({ amount: null, hasPayment: false });
  });

  it('el cobro NO depende de isCharge: envío normal con payment sí tiene cobro', () => {
    expect(resolvePackagePayment({ payment: { amount: 50 } } as any)).toEqual({ amount: 50, hasPayment: true });
  });
});
