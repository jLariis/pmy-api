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

describe('UnloadingService.getUnloadingSessionInit', () => {
  it('devuelve el universo esperado completo por consolidado', async () => {
    const consolidatedReporsitory = repo();
    consolidatedReporsitory.find.mockResolvedValue([
      { id: 'c1', type: ConsolidatedType.AEREO, numberOfPackages: 2, consNumber: 'CN-001' },
    ]);

    const shipmentRepository = repo();
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '111', consolidatedId: 'c1', recipientName: 'Ana' },
      { trackingNumber: '222', dhlUniqueId: 'JD00222', consolidatedId: 'c1', recipientName: 'Beto' },
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
    expect(result.airConsolidated[0].consNumber).toBe('CN-001');
    expect(result.airConsolidated[0].expected.map((e) => e.trackingNumber).sort())
      .toEqual(['111', '222']);
    // El universo esperado conserva el dhlUniqueId para casar guías DHL en el cliente.
    const beto = result.airConsolidated[0].expected.find((e) => e.trackingNumber === '222');
    expect(beto?.dhlUniqueId).toBe('JD00222');
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

  // Regresión DHL: varias piezas comparten trackingNumber (guía maestra/AWB) pero
  // tienen distinto dhlUniqueId (JD). NO deben colapsarse: cada pieza es única por
  // su JD. Antes se deduplicaba por trackingNumber y las dejaba como una sola,
  // descuadrando el conteo (todo aparecía como faltante al escanear los JD).
  it('NO colapsa piezas DHL que comparten la guía maestra (dedup por JD)', async () => {
    const consolidatedReporsitory = repo();
    consolidatedReporsitory.find.mockResolvedValue([
      { id: 'c1', type: ConsolidatedType.AEREO, numberOfPackages: 3 },
    ]);
    const shipmentRepository = repo();
    // Guía maestra 1872360291 con 3 piezas (3 JD distintos) + otra guía single.
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '1872360291', dhlUniqueId: 'JD014600012668482721', consolidatedId: 'c1' },
      { trackingNumber: '1872360291', dhlUniqueId: 'JD014600012668482719', consolidatedId: 'c1' },
      { trackingNumber: '1872360291', dhlUniqueId: 'JD014600012668482720', consolidatedId: 'c1' },
    ]);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.find.mockResolvedValue([]);

    const { svc } = makeService({ consolidatedReporsitory, shipmentRepository, chargeShipmentRepository });
    const result = await svc.getUnloadingSessionInit('sub-1');

    // Las 3 piezas sobreviven, identificadas por su JD (dhlUniqueId).
    expect(result.airConsolidated[0].expected).toHaveLength(3);
    expect(result.airConsolidated[0].expected.map((e) => e.dhlUniqueId).sort()).toEqual([
      'JD014600012668482719',
      'JD014600012668482720',
      'JD014600012668482721',
    ]);
  });
});

describe('UnloadingService.getUnloadingConsolidatedByConsNumber', () => {
  function qbMock(consolidated: any) {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(consolidated),
    };
    return qb;
  }

  it('devuelve el consolidado con su universo esperado en formato session-init', async () => {
    const consolidatedReporsitory = repo() as any;
    consolidatedReporsitory.createQueryBuilder = jest.fn().mockReturnValue(
      qbMock({ id: 'c9', type: ConsolidatedType.ORDINARIA, numberOfPackages: 2, consNumber: 'CN-999' }),
    );
    const shipmentRepository = repo();
    shipmentRepository.find.mockResolvedValue([
      { trackingNumber: '333', consolidatedId: 'c9', recipientName: 'Cira' },
      { trackingNumber: '444', dhlUniqueId: 'JD00444', consolidatedId: 'c9', recipientName: 'Dan' },
    ]);
    const chargeShipmentRepository = repo();
    chargeShipmentRepository.find.mockResolvedValue([]);

    const { svc } = makeService({ consolidatedReporsitory, shipmentRepository, chargeShipmentRepository });
    const result = await svc.getUnloadingConsolidatedByConsNumber('sub-1', ' cn-999 ');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('c9');
    expect(result!.typeCode).toBe('TER');
    expect(result!.consNumber).toBe('CN-999');
    expect(result!.numberOfPackages).toBe(2);
    expect(result!.expected.map((e) => e.trackingNumber).sort()).toEqual(['333', '444']);
  });

  it('devuelve null cuando el consolidado no existe', async () => {
    const consolidatedReporsitory = repo() as any;
    consolidatedReporsitory.createQueryBuilder = jest.fn().mockReturnValue(qbMock(null));
    const { svc } = makeService({ consolidatedReporsitory });
    expect(await svc.getUnloadingConsolidatedByConsNumber('sub-1', 'CN-000')).toBeNull();
  });

  it('devuelve null cuando el consNumber viene vacío', async () => {
    const { svc } = makeService();
    expect(await svc.getUnloadingConsolidatedByConsNumber('sub-1', '   ')).toBeNull();
  });
});
