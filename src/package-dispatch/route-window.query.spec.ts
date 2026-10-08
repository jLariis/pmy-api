import { loadRouteWindowContext, routeWindowKey } from './route-window.query';

describe('loadRouteWindowContext', () => {
  it('arma siguiente salida por guía y arreglos manuales', async () => {
    const db: any = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { sid: null, cid: 'c1', nextAt: '2026-10-06T18:47:57.000Z' },
          { sid: 's1', cid: null, nextAt: null },
        ])
        .mockResolvedValueOnce([
          { shipmentId: null, chargeShipmentId: 'c2', closureStatus: 'entregado', closureExceptionCode: null, closureStatusAt: '2026-10-08T16:02:00.000Z' },
        ]),
    };
    const ctx = await loadRouteWindowContext(db, 'pd-1');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][1]).toEqual(['pd-1', 'pd-1', 'pd-1', 'pd-1']);
    expect(ctx.nextDispatchAt.get(routeWindowKey('charge', 'c1'))?.toISOString()).toBe('2026-10-06T18:47:57.000Z');
    expect(ctx.nextDispatchAt.has(routeWindowKey('shipment', 's1'))).toBe(false);
    expect(ctx.overrides.get(routeWindowKey('charge', 'c2'))).toMatchObject({ status: 'entregado', exceptionCode: null });
  });
});
