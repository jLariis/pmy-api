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

  const makeSvc = (historyRows: any[], sortByCp = false) => {
    const svc = Object.create(PackageDispatchService.prototype) as any;
    // FedEx no-op (no debe romper la carga).
    svc.updateFedexDataByPackageDispatchId = jest.fn().mockResolvedValue([]);
    svc.packageDispatchRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: THIS_PD,
        trackingNumber: '860409534766',
        subsidiary: { id: 'sub-1', sortDispatchByPostalCode: sortByCp },
      }),
    };
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
});
