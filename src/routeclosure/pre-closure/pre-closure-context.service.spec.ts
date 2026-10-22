import { NotFoundException } from '@nestjs/common';
import { assemblePreClosureContext, PreClosureContextService } from './pre-closure-context.service';

const dispatch = { id: 'd1', routeDate: new Date('2026-10-20T07:00:00.000Z'), createdAt: new Date('2026-10-20T15:00:00.000Z'), is315: 0 };
const DUE_TODAY = '2026-10-20T19:00:00.000Z';

describe('assemblePreClosureContext', () => {
  const packages = [
    { id: 's1', isCharge: 0, trackingNumber: 'T1', status: 'en_ruta', commitDateTime: DUE_TODAY },
    { id: 's2', isCharge: 0, trackingNumber: 'T2', status: 'entregado', commitDateTime: DUE_TODAY },
    { id: 'c1', isCharge: 1, trackingNumber: 'T3', status: 'cliente_no_disponible', commitDateTime: DUE_TODAY },
  ];

  it('devuelve señales por guía e ingreso entregado solo para paquetes', () => {
    const ctx = assemblePreClosureContext({
      dispatch,
      packages,
      statusRows: [
        // "en ruta" que pone el sistema al despachar: NO es movimiento.
        { shipmentId: 's1', chargeShipmentId: null, status: 'en_ruta', exceptionCode: '', timestamp: '2026-10-20T15:00:00.000Z' },
        { shipmentId: 's2', chargeShipmentId: null, status: 'entregado', exceptionCode: '', timestamp: '2026-10-20T20:00:00.000Z' },
        { shipmentId: null, chargeShipmentId: 'c1', status: 'cliente_no_disponible', exceptionCode: '08', timestamp: '2026-10-20T21:00:00.000Z' },
      ],
      deliveredIncomeShipmentIds: new Set(['s2']),
    });

    expect(ctx.routeDay).toBe('2026-10-20');
    expect(ctx.is315).toBe(false);
    expect(ctx.packages).toEqual([
      { id: 's1', isCharge: false, trackingNumber: 'T1', hasDeliveredIncome: false, noMovement: true, dueToday: true, ldState: 'possible_ld' },
      { id: 's2', isCharge: false, trackingNumber: 'T2', hasDeliveredIncome: true, noMovement: false, dueToday: true, ldState: 'delivered' },
      { id: 'c1', isCharge: true, trackingNumber: 'T3', hasDeliveredIncome: false, noMovement: false, dueToday: true, ldState: 'active' },
    ]);
  });

  it('mide el LD con el estatus del día de la ruta: entregada después sigue en riesgo', () => {
    const ctx = assemblePreClosureContext({
      dispatch,
      packages: [{ id: 's9', isCharge: 0, trackingNumber: 'T9', status: 'entregado', commitDateTime: DUE_TODAY }],
      statusRows: [{ shipmentId: 's9', chargeShipmentId: null, status: 'entregado', exceptionCode: '', timestamp: '2026-10-21T18:00:00.000Z' }],
      deliveredIncomeShipmentIds: new Set(),
      closureStatuses: new Map([['s:s9', 'en_ruta']]),
    });
    expect(ctx.packages[0]).toMatchObject({ noMovement: true, dueToday: true, ldState: 'possible_ld' });
  });

  it('carga → hasDeliveredIncome false aunque su id aparezca', () => {
    const ctx = assemblePreClosureContext({ dispatch, packages: [packages[2]], statusRows: [], deliveredIncomeShipmentIds: new Set(['c1']) });
    expect(ctx.packages[0].hasDeliveredIncome).toBe(false);
  });

  it('sin routeDate usa el día Hermosillo de createdAt', () => {
    const ctx = assemblePreClosureContext({
      dispatch: { ...dispatch, routeDate: null, createdAt: new Date('2026-10-21T05:00:00.000Z') },
      packages: [],
      statusRows: [],
      deliveredIncomeShipmentIds: new Set(),
    });
    expect(ctx.routeDay).toBe('2026-10-20');
  });
});

describe('PreClosureContextService', () => {
  it('salida inexistente → NotFound', async () => {
    const svc = new PreClosureContextService({ query: jest.fn(async () => []) } as any);
    await expect(svc.getContext('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('salida sin guías no consulta historial ni ingresos', async () => {
    const query = jest.fn(async (sql: string) => (sql.includes('FROM package_dispatch ') ? [dispatch] : []));
    const svc = new PreClosureContextService({ query } as any);
    const ctx = await svc.getContext('d1');
    expect(ctx.packages).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
