// p-limit es ESM y rompe el parseo de jest al entrar por shipments.service.
// El test instancia el servicio directamente y nunca ejercita ese código.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: any) => fn(),
}));

import { UnloadingService } from './unloading.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';

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
  );
  return { svc, deps };
}

describe('UnloadingService.getUnloadingSessionInit', () => {
  it('devuelve el universo esperado completo por consolidado', async () => {
    const consolidatedReporsitory = repo();
    consolidatedReporsitory.find.mockResolvedValue([
      { id: 'c1', type: ConsolidatedType.AEREO, numberOfPackages: 2 },
    ]);

    const shipmentRepository = repo();
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
      { trackingNumber: '222', consolidatedId: 'c1', recipientName: 'Beto' },
    ]);

    const chargeShipmentRepository = repo();
    chargeShipmentRepository.find.mockResolvedValue([]);

    const { svc } = makeService({
      consolidatedReporsitory,
      shipmentRepository,
      chargeShipmentRepository,
    });

    const result = await svc.getUnloadingSessionInit('sub-1');

    expect(result.airConsolidated).toHaveLength(1);
    expect(result.airConsolidated[0].id).toBe('c1');
    expect(result.airConsolidated[0].numberOfPackages).toBe(2);
    expect(result.airConsolidated[0].expected.map((e) => e.trackingNumber).sort())
      .toEqual(['111', '222']);
    expect(result.groundConsolidated).toHaveLength(0);
  });

  it('deduplica guías repetidas dentro del universo esperado', async () => {
    const consolidatedReporsitory = repo();
    consolidatedReporsitory.find.mockResolvedValue([
      { id: 'c1', type: ConsolidatedType.AEREO, numberOfPackages: 1 },
    ]);
    const shipmentRepository = repo();
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
    ]);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.find.mockResolvedValue([]);

    const { svc } = makeService({ consolidatedReporsitory, shipmentRepository, chargeShipmentRepository });
    const result = await svc.getUnloadingSessionInit('sub-1');
    expect(result.airConsolidated[0].expected).toHaveLength(1);
  });
});
