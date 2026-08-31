// p-limit v7 es ESM puro y rompe el transform de jest al colarse por ShipmentsService.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { TrackingSyncPersistCron } from './tracking-sync-persist.cron';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('TrackingSyncPersistCron', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  function make() {
    const shipmentsService: any = {
      getShipmentsToValidate: jest.fn().mockResolvedValue([
        { id: 's1', trackingNumber: 'A', status: ShipmentStatusType.PENDIENTE, subsidiary: { id: 'sub1' } },
        { id: 's2', trackingNumber: 'B', status: ShipmentStatusType.EN_RUTA, subsidiary: { id: 'sub1' } },
      ]),
      getSimpleChargeShipments: jest.fn().mockResolvedValue([]),
    };
    const compare: any = { applyMany: jest.fn().mockResolvedValue([{ applied: true }, { applied: false }]) };
    return { cron: new TrackingSyncPersistCron(shipmentsService, compare), shipmentsService, compare };
  }

  it('cutover OFF (default) → no hace nada', async () => {
    delete process.env.TRACKING_SYNC_CUTOVER;
    const { cron, shipmentsService, compare } = make();
    await cron.handlePersistCron();
    expect(shipmentsService.getShipmentsToValidate).not.toHaveBeenCalled();
    expect(compare.applyMany).not.toHaveBeenCalled();
  });

  it('cutover ON → applyMany con las guías (caliente primero)', async () => {
    process.env.TRACKING_SYNC_CUTOVER = 'true';
    delete process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES;
    const { cron, compare } = make();
    await cron.handlePersistCron();
    expect(compare.applyMany).toHaveBeenCalledTimes(1);
    const ids = compare.applyMany.mock.calls[0][0];
    expect(ids).toEqual(['s2', 's1']); // EN_RUTA (caliente) antes que PENDIENTE
  });

  it('allowlist filtra por sucursal', async () => {
    process.env.TRACKING_SYNC_CUTOVER = 'true';
    process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES = 'otra';
    const { cron, compare } = make();
    await cron.handlePersistCron();
    expect(compare.applyMany).not.toHaveBeenCalled(); // ninguna guía es de 'otra'
  });
});
