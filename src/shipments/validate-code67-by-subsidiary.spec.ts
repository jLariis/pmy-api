// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque shipments.service
// lo importa a nivel de módulo. No lo usamos en este spec.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';

/**
 * Reporte "Visibilidad 67" (`validateCode67BySubsidiary`): mismo motor que el reporte "Sin código
 * 44" — cuenta el escaneo local que haya dado FedEx (44 o 67), sin importar la config de la
 * sucursal, y los días se cuentan completos en hora Hermosillo (escaneada anoche = al día).
 * Antes (SUP-0005) solo contaba el código configurado y las satélites de Obregón salían "nunca".
 */
describe('ShipmentsService.validateCode67BySubsidiary (código de escaneo por sucursal)', () => {
  const SUB_ID = 'sub-1';

  function mkShipment(exceptionCode: string, timestamp: Date) {
    return {
      trackingNumber: 'T1',
      status: 'en_bodega',
      recipientName: 'X',
      createdAt: new Date('2026-08-01T12:00:00Z'),
      statusHistory: [{ exceptionCode, timestamp }],
    };
  }

  function svcWith(monitorFedexCode44: boolean, shipment: any) {
    const svc = Object.create(ShipmentsService.prototype) as any;
    svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    svc.shipmentRepository = { find: jest.fn().mockResolvedValue([shipment]) };
    svc.chargeShipmentRepository = { find: jest.fn().mockResolvedValue([]) };
    svc.subsidiaryRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: SUB_ID, monitorFedexCode44 }),
      findOne: jest.fn().mockResolvedValue({ id: SUB_ID, monitorFedexCode44 }),
    };
    return svc;
  }

  it('sucursal por default (código 67): una guía con escaneo 67 HOY queda en categoría "hoy"', async () => {
    const svc = svcWith(false, mkShipment('67', new Date()));
    const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
    expect(details[0].category).toBe('hoy');
    expect(details[0].has67Today).toBe(true);
  });

  it('sucursal de código 44: una guía con escaneo 44 HOY queda en categoría "hoy" (no "nunca")', async () => {
    const svc = svcWith(true, mkShipment('44', new Date()));
    const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
    expect(details[0].category).toBe('hoy');
    expect(details[0].has67Today).toBe(true);
  });

  it('sucursal de código 44 que pasó a fase 67: el 67 SÍ cuenta (el código lo dice FedEx)', async () => {
    const svc = svcWith(true, mkShipment('67', new Date()));
    const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
    expect(details[0].category).toBe('hoy');
    expect(details[0].scanCode).toBe('67');
    expect(details[0].configuredCode).toBe('44');
  });

  it('sucursal configurada en 67 a la que FedEx manda el 44 (satélites de Obregón) → al día', async () => {
    const svc = svcWith(false, mkShipment('44', new Date()));
    const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
    expect(details[0].category).toBe('hoy');
    expect(details[0].scanCode).toBe('44');
  });

  describe('días completos en hora Hermosillo (FedEx escanea de noche)', () => {
    // "Ahora" = 10-oct-2026 09:00 Hermosillo.
    beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-10T16:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
    afterAll(() => jest.useRealTimers());

    it('escaneada anoche (09-oct 21:36) → al día (0)', async () => {
      const svc = svcWith(false, mkShipment('67', new Date('2026-10-10T04:36:00Z')));
      const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
      expect(details[0].daysSinceLast67).toBe(0);
      expect(details[0].category).toBe('hoy');
    });

    it('último escaneo antenoche → 1 día sin código', async () => {
      const svc = svcWith(false, mkShipment('44', new Date('2026-10-09T04:36:00Z')));
      const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
      expect(details[0].daysSinceLast67).toBe(1);
      expect(details[0].category).toBe('sin67');
    });

    it('sin 44 ni 67 → nunca', async () => {
      const svc = svcWith(false, mkShipment('07', new Date('2026-10-09T04:36:00Z')));
      const { details, summary } = await svc.validateCode67BySubsidiary(SUB_ID);
      expect(details[0].category).toBe('nunca');
      expect(summary.nunca).toBe(1);
    });
  });

  it('solo FedEx: envíos y cargas se consultan con shipmentType=fedex (DHL nunca se mezcla)', async () => {
    const svc = svcWith(false, mkShipment('67', new Date()));
    await svc.validateCode67BySubsidiary(SUB_ID);
    expect(svc.shipmentRepository.find.mock.calls[0][0].where.shipmentType).toBe('fedex');
    expect(svc.chargeShipmentRepository.find.mock.calls[0][0].where.shipmentType).toBe('fedex');
  });
});
