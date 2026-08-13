// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque shipments.service
// lo importa a nivel de módulo. No lo usamos en este spec.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';

/**
 * SUP-0005: el reporte de "Visibilidad 67" (`validateCode67BySubsidiary`) debe usar el código de
 * escaneo local que monitorea la sucursal — 67 por default, o 44 cuando `monitorFedexCode44 = true`
 * (mismo criterio que MonitoringService / getFedex44Visibility). Antes hardcodeaba '67', así que en
 * sucursales de código 44 las guías escaneadas HOY con 44 caían en categoría 'nunca'/'sin67'.
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

  it('sucursal de código 44: un escaneo 67 (que ya no es su código) NO cuenta como visibilidad de hoy', async () => {
    const svc = svcWith(true, mkShipment('67', new Date()));
    const { details } = await svc.validateCode67BySubsidiary(SUB_ID);
    expect(details[0].category).toBe('nunca');
  });
});
