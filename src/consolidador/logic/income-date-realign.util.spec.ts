import { isDayStartAnchored, resolveIncomeEventDate } from './income-date-realign.util';

describe('isDayStartAnchored', () => {
  it('detecta las 00:00 Hermosillo exactas (07:00:00Z)', () => {
    expect(isDayStartAnchored('2026-10-06T07:00:00.000Z')).toBe(true);
    expect(isDayStartAnchored('2026-10-07T17:40:00.000Z')).toBe(false);
    expect(isDayStartAnchored('2026-10-06T07:00:01.000Z')).toBe(false);
  });
});

describe('resolveIncomeEventDate', () => {
  const history = [
    { status: 'en_ruta', timestamp: '2026-10-06T19:33:37Z', exceptionCode: '', notes: 'Salida a ruta (Folio Despacho: x)' },
    { status: 'entregado', timestamp: '2026-10-07T17:40:00Z', exceptionCode: '', notes: 'Delivered' },
  ];

  it('ENTREGADO: fecha = evento de entrega de FedEx (caso Loreto 383934388357)', () => {
    const d = resolveIncomeEventDate({ incomeType: 'entregado', date: '2026-10-06T07:00:00Z' }, history);
    expect(d?.correctDate.toISOString()).toBe('2026-10-07T17:40:00.000Z');
  });

  it('ENTREGADO sin evento de entrega → null (se deja para revisión)', () => {
    expect(resolveIncomeEventDate({ incomeType: 'entregado', date: '2026-10-06T07:00:00Z' }, history.slice(0, 1))).toBeNull();
  });

  it('DEX: el evento del mismo día del ingreso con su código', () => {
    const dex = [
      { status: 'rechazado', timestamp: '2026-10-06T20:15:00Z', exceptionCode: '07' },
      { status: 'rechazado', timestamp: '2026-10-09T20:15:00Z', exceptionCode: '07' },
    ];
    const d = resolveIncomeEventDate({ incomeType: 'no_entregado', nonDeliveryStatus: '07', date: '2026-10-06T07:00:00Z' }, dex);
    expect(d?.correctDate.toISOString()).toBe('2026-10-06T20:15:00.000Z');
  });

  it('DEX: si no hay del mismo día, el primero posterior', () => {
    const dex = [{ status: 'rechazado', timestamp: '2026-10-07T18:00:00Z', exceptionCode: '07' }];
    const d = resolveIncomeEventDate({ incomeType: 'no_entregado', nonDeliveryStatus: '07', date: '2026-10-06T07:00:00Z' }, dex);
    expect(d?.correctDate.toISOString()).toBe('2026-10-07T18:00:00.000Z');
  });

  it('DEX sin código → null', () => {
    expect(resolveIncomeEventDate({ incomeType: 'no_entregado', nonDeliveryStatus: null, date: '2026-10-06T07:00:00Z' }, history)).toBeNull();
  });
});
