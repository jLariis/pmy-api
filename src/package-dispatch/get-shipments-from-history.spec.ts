// p-limit es ESM puro y jest no lo transforma; lo stubeamos porque la cadena de
// imports de PackageDispatchService lo arrastra (vía shipments.service).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { PackageDispatchService } from './package-dispatch.service';

/**
 * `getShipmentsByPackageDispatchId` alimenta la pantalla de cierre. Debe armar los
 * paquetes desde `package_dispatch_history` (append-only) — NO desde la relación viva
 * `shipments`, que pierde las guías re-escaneadas en otra salida (FK único `routeId`).
 * Además marca `movedToAnotherRoute` para que el cierre las pinte sin bloquear.
 */
describe('PackageDispatchService.getShipmentsByPackageDispatchId (historial)', () => {
  const THIS_PD = 'pd-1';

  const makeSvc = (historyRows: any[], sortByCp = false, extra: { subsidiary?: any; windowRows?: any[]; routeDate?: string } = {}) => {
    const svc = Object.create(PackageDispatchService.prototype) as any;
    // FedEx no-op (no debe romper la carga).
    svc.updateFedexDataByPackageDispatchId = jest.fn().mockResolvedValue([]);
    svc.packageDispatchRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: THIS_PD,
        trackingNumber: '860409534766',
        routeDate: extra.routeDate,
        subsidiary: { id: 'sub-1', sortDispatchByPostalCode: sortByCp, ...extra.subsidiary },
      }),
    };
    // loadRouteWindowContext: 1ª consulta = siguiente salida, 2ª = arreglos manuales.
    svc.dataSource = { query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(extra.windowRows ?? []) };
    svc.packageDispatchHistoryRepository = {
      find: jest.fn().mockResolvedValue(historyRows),
    };
    return svc;
  };

  const ship = (id: string, currentPdId: string | null, currentFolio?: string) => ({
    id,
    trackingNumber: `T-${id}`,
    status: 'en_ruta',
    recipientZip: '85000',
    packageDispatch: currentPdId ? { id: currentPdId, trackingNumber: currentFolio } : null,
  });

  it('trae TODAS las guías del historial aunque una se haya reasignado (10, no 9)', async () => {
    const rows = [
      { shipment: ship('s1', THIS_PD) },
      { shipment: ship('s2', THIS_PD) },
      // s3 ya se fue a otra salida a ruta (su FK apunta a pd-2):
      { shipment: ship('s3', 'pd-2', '999900001111') },
    ];
    const svc = makeSvc(rows);

    const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);

    expect(res.shipments).toHaveLength(3);
    expect(res.shipments.map((s: any) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('marca movedToAnotherRoute + folio de la ruta nueva solo en la reasignada', async () => {
    const rows = [
      { shipment: ship('s1', THIS_PD) },
      { shipment: ship('s3', 'pd-2', '999900001111') },
    ];
    const svc = makeSvc(rows);

    const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);
    const s1 = res.shipments.find((s: any) => s.id === 's1');
    const s3 = res.shipments.find((s: any) => s.id === 's3');

    expect(s1.movedToAnotherRoute).toBe(false);
    expect(s1.currentDispatchTrackingNumber).toBeNull();
    expect(s3.movedToAnotherRoute).toBe(true);
    expect(s3.currentDispatchTrackingNumber).toBe('999900001111');
  });

  it('trata FK null (sin ruta) como NO movida (no bloquea ni confunde)', async () => {
    const rows = [{ shipment: ship('s4', null) }];
    const svc = makeSvc(rows);

    const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);
    expect(res.shipments[0].movedToAnotherRoute).toBe(false);
  });

  it('separa shipments de chargeShipments y dedup por id', async () => {
    const rows = [
      { shipment: ship('s1', THIS_PD) },
      { shipment: ship('s1', THIS_PD) }, // duplicado en historial
      { chargeShipment: ship('c1', THIS_PD) },
    ];
    const svc = makeSvc(rows);

    const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);
    expect(res.shipments).toHaveLength(1);
    expect(res.chargeShipments).toHaveLength(1);
    expect(res.chargeShipments[0].id).toBe('c1');
  });

  describe('estatus del cierre (Vía Larga 929567984667, ruta del 07-oct)', () => {
    const charge = {
      id: 'c1',
      trackingNumber: '383870018494',
      status: 'entregado',
      packageDispatch: { id: THIS_PD },
      statusHistory: [
        { status: 'en_ruta', timestamp: '2026-10-07T17:09:17.000Z' },
        { status: 'entregado', timestamp: '2026-10-08T16:02:00.000Z' },
      ],
    };

    it('sin la opción: entregado del día siguiente → el cierre la ve en ruta', async () => {
      const svc = makeSvc([{ chargeShipment: charge }], false, { routeDate: '2026-10-07' });
      const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);
      expect(res.chargeShipments[0].routeDayStatus).toBe('en_ruta');
    });

    it('con closureUntilNextDispatch: el cierre la ve entregada', async () => {
      const svc = makeSvc([{ chargeShipment: charge }], false, {
        routeDate: '2026-10-07',
        subsidiary: { closureUntilNextDispatch: true },
      });
      const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);
      expect(res.chargeShipments[0].routeDayStatus).toBe('entregado');
      expect(res.chargeShipments[0].closureFixedManually).toBe(false);
    });

    it('el arreglo manual de "Paquetes con problema" gana', async () => {
      const svc = makeSvc([{ chargeShipment: charge }], false, {
        routeDate: '2026-10-07',
        windowRows: [{
          shipmentId: null, chargeShipmentId: 'c1', nextAt: null,
          closureStatus: 'rechazado', closureExceptionCode: '07', closureStatusAt: '2026-10-08T16:00:00.000Z',
        }],
      });
      const res = await svc.getShipmentsByPackageDispatchId(THIS_PD);
      expect(res.chargeShipments[0].routeDayStatus).toBe('rechazado');
      expect(res.chargeShipments[0].routeDayExceptionCode).toBe('07');
      expect(res.chargeShipments[0].closureFixedManually).toBe(true);
    });
  });
});
