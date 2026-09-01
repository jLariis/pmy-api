// p-limit v7 es ESM puro y rompe el transform de jest al colarse por ShipmentsService.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { TrackingSyncPersistCron } from './tracking-sync-persist.cron';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('TrackingSyncPersistCron', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; jest.restoreAllMocks(); });

  function make() {
    const compare: any = { applyMany: jest.fn().mockResolvedValue([{ applied: true }, { applied: false }]) };
    const shipmentsService: any = {
      getShipmentsToValidate: jest.fn().mockResolvedValue([{ id: 's1', status: ShipmentStatusType.PENDIENTE, subsidiary: { id: 'sub1' } }]),
      getSimpleChargeShipments: jest.fn().mockResolvedValue([]),
    };
    const routeUniverse: any = {
      hermosilloHour: jest.fn().mockReturnValue(10),
      todayRouteItems: jest.fn().mockResolvedValue([
        { kind: 'shipment', entity: { id: 'a', status: ShipmentStatusType.PENDIENTE, subsidiary: { id: 'sub1' } } },
        { kind: 'shipment', entity: { id: 'b', status: ShipmentStatusType.EN_RUTA, subsidiary: { id: 'sub1' } } },
      ]),
    };
    const cron = new TrackingSyncPersistCron(shipmentsService, compare, routeUniverse);
    return { cron, compare, shipmentsService, routeUniverse };
  }

  describe('handleRouteSync (15 min, rutas del día)', () => {
    it('cutover OFF → no hace nada', async () => {
      delete process.env.TRACKING_SYNC_CUTOVER;
      const { cron, compare } = make();
      await cron.handleRouteSync();
      expect(compare.applyMany).not.toHaveBeenCalled();
    });

    it('cutover ON + en horario → applyMany con las guías de ruta (calientes primero)', async () => {
      process.env.TRACKING_SYNC_CUTOVER = 'true';
      const { cron, compare } = make();
      await cron.handleRouteSync();
      expect(compare.applyMany).toHaveBeenCalledTimes(1);
      expect(compare.applyMany.mock.calls[0][0]).toEqual(['b', 'a']); // EN_RUTA (caliente) primero
    });

    it('cutover ON + fuera de horario → no hace nada', async () => {
      process.env.TRACKING_SYNC_CUTOVER = 'true';
      const { cron, compare, routeUniverse } = make();
      routeUniverse.hermosilloHour.mockReturnValue(3); // 3am, fuera de 7–22
      await cron.handleRouteSync();
      expect(routeUniverse.todayRouteItems).not.toHaveBeenCalled();
      expect(compare.applyMany).not.toHaveBeenCalled();
    });
  });

  describe('handleDailySweep', () => {
    it('cutover OFF → no hace nada', async () => {
      delete process.env.TRACKING_SYNC_CUTOVER;
      const { cron, compare } = make();
      await cron.handleDailySweep();
      expect(compare.applyMany).not.toHaveBeenCalled();
    });

    it('cutover ON → procesa la cola pendiente completa', async () => {
      process.env.TRACKING_SYNC_CUTOVER = 'true';
      const { cron, compare, shipmentsService } = make();
      await cron.handleDailySweep();
      expect(shipmentsService.getShipmentsToValidate).toHaveBeenCalled();
      expect(compare.applyMany).toHaveBeenCalledWith(['s1'], expect.objectContaining({ role: 'system' }));
    });
  });
});
