// p-limit es ESM y rompe el parseo de jest al entrar por shipments.service.
// El test instancia el servicio directamente y nunca ejercita ese código.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: any) => fn(),
}));

import { UnloadingService } from './unloading.service';

function repo() {
  return { find: jest.fn(), findOne: jest.fn() };
}

function makeService(overrides: Record<string, any> = {}) {
  const deps: any = {
    unloadingRepository: repo(),
    shipmentRepository: repo(),
    chargeShipmentRepository: repo(),
    consolidatedReporsitory: repo(),
    chargeRepository: repo(),
    mailService: {},
    shipmentService: {},
    shipmentStatusRepository: repo(),
    dataSource: {},
    templateService: {},
    ...overrides,
  };
  const svc = new UnloadingService(
    deps.unloadingRepository,
    deps.shipmentRepository,
    deps.chargeShipmentRepository,
    deps.consolidatedReporsitory,
    deps.chargeRepository,
    deps.mailService,
    deps.shipmentService,
    deps.shipmentStatusRepository,
    deps.dataSource,
    deps.templateService,
  );
  return { svc, deps };
}

describe('UnloadingService.validateOne', () => {
  it('valida un shipment de la sucursal correcta', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      id: 'ship-1', trackingNumber: '111', dhlUniqueId: 'JD00111', consolidatedId: 'c1', subsidiary: { id: 'sub-1' },
      recipientName: 'Ana', priority: 'alta',
    });
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue(null);

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('JD00111', 'sub-1');

    expect(r.isValid).toBe(true);
    expect(r.isCharge).toBe(false);
    expect(r.id).toBe('ship-1');
    expect(r.consolidatedId).toBe('c1');
    expect(r.recipientName).toBe('Ana');
    // Devuelve el dhlUniqueId para que el cliente pueda casar la guía DHL escaneada.
    expect(r.dhlUniqueId).toBe('JD00111');
  });

  it('marca inválido si el paquete es de otra sucursal', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue({
      trackingNumber: '111', consolidatedId: 'c1', subsidiary: { id: 'otra' },
    });
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue(null);

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('111', 'sub-1');

    expect(r.isValid).toBe(false);
    expect(r.reason).toContain('sucursal');
  });

  it('usa el chargeShipment si no hay shipment', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue(null);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue({
      trackingNumber: '999', consolidatedId: 'c2', subsidiary: { id: 'sub-1' },
    });

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('999', 'sub-1');

    expect(r.isValid).toBe(true);
    expect(r.isCharge).toBe(true);
    expect(r.consolidatedId).toBe('c2');
  });

  it('devuelve no encontrado cuando no existe en ninguna tabla', async () => {
    const shipmentRepository = repo();
    shipmentRepository.findOne.mockResolvedValue(null);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.findOne.mockResolvedValue(null);

    const { svc } = makeService({ shipmentRepository, chargeShipmentRepository });
    const r = await svc.validateOne('000', 'sub-1');

    expect(r.isValid).toBe(false);
    expect(r.isCharge).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
