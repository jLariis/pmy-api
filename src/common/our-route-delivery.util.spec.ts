import { isOurRouteDelivery, routeDaysOf } from './our-route-delivery.util';

describe('isOurRouteDelivery', () => {
  // 877179272633 (Cabo): ruta nuestra del 21-09, DL 005 el 21-09 16:40 Hermosillo (23:40Z).
  it('DL el mismo día (Hermosillo) que una ruta nuestra y con consolidado → es nuestra', () => {
    expect(isOurRouteDelivery({ deliveredAt: new Date('2026-09-21T23:40:00Z'), routeDays: ['2026-09-21'], hasConsolidado: true })).toBe(true);
  });

  it('usa el día Hermosillo: 23:30 local del 21 (06:30Z del 22) sigue siendo del 21', () => {
    expect(isOurRouteDelivery({ deliveredAt: new Date('2026-09-22T06:30:00Z'), routeDays: ['2026-09-21'], hasConsolidado: true })).toBe(true);
  });

  it('ruta nuestra de OTRO día → no es nuestra (FedEx la entregó después)', () => {
    expect(isOurRouteDelivery({ deliveredAt: new Date('2026-09-23T20:00:00Z'), routeDays: ['2026-09-21'], hasConsolidado: true })).toBe(false);
  });

  it('sin ruta nuestra → no es nuestra', () => {
    expect(isOurRouteDelivery({ deliveredAt: new Date('2026-09-21T20:00:00Z'), routeDays: [], hasConsolidado: true })).toBe(false);
  });

  it('sin consolidado nuestro → no es nuestra', () => {
    expect(isOurRouteDelivery({ deliveredAt: new Date('2026-09-21T20:00:00Z'), routeDays: ['2026-09-21'], hasConsolidado: false })).toBe(false);
  });

  it('sin fecha de entrega → no se puede afirmar', () => {
    expect(isOurRouteDelivery({ deliveredAt: null, routeDays: ['2026-09-21'], hasConsolidado: true })).toBe(false);
  });
});

describe('routeDaysOf', () => {
  it('routeDate (DATE) tal cual; sin routeDate usa el día Hermosillo de createdAt', () => {
    expect(routeDaysOf([{ routeDate: '2026-09-21' }, { routeDate: null, createdAt: new Date('2026-09-22T05:00:00Z') }])).toEqual(['2026-09-21']);
    expect(routeDaysOf([{ routeDate: new Date('2026-09-21T00:00:00Z') }])).toEqual(['2026-09-21']);
  });
});
