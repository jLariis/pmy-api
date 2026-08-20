// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos (el import de
// PackageDispatchService arrastra shipments.service, que lo importa a nivel de módulo).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { RouteclosureService } from './routeclosure.service';
import { Collection, Income, ShipmentNotInFiles } from 'src/entities';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { PackageDispatchService } from 'src/package-dispatch/package-dispatch.service';
import { PackageDispatch, Shipment } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * Verificación de las correcciones del CIERRE A RUTA (route-closure).
 *
 * Cubre en el backend (pmy-api):
 *  (1) No VAN → se resuelven en FedEx y, si aplican cobro, generan ingreso.
 *  (4) La salida a ruta persiste `is315` y `routeDate`.
 *  (5) Las recolecciones del cierre generan ingreso, SALVO ruta 31.5 (regla nueva):
 *      si el despacho es `is315`, las recolecciones se guardan pero NO cobran.
 *
 * (Punto 2 "es_ocurre no bloquea el cierre" es un fix de FRONTEND en app-pmy
 *  —classifyClosureBucket, con su propio Vitest— y no tiene lógica en el API.)
 * (Punto 3 "estatus preexistente del mismo día" está cubierto por
 *  fedex-prereg-and-commit.spec.ts.)
 */

// ---------------------------------------------------------------------------
// Harness de RouteclosureService.create (I/O TypeORM mockeada por entidad).
// ---------------------------------------------------------------------------
function makeRouteClosureService(packageDispatch: any, opts: { existingIncome?: (where: any) => any } = {}) {
  const savedIncomes: any[] = [];
  const savedCollections: any[] = [];
  const savedNoVan: any[] = [];

  const manager: any = {
    findOne: jest.fn(async (entity: any, findOpts: any) => {
      if (entity === Income) return opts.existingIncome ? opts.existingIncome(findOpts?.where) : null;
      if (entity === PackageDispatch) return packageDispatch;
      // Shipment / ChargeShipment (procesamiento DHL): no hay en estas pruebas.
      return null;
    }),
    create: jest.fn((_entity: any, data: any) => data),
    save: jest.fn(async (entity: any, data: any) => {
      if (entity === Collection) {
        const arr = Array.isArray(data) ? data : [data];
        const withIds = arr.map((c: any, i: number) => ({ ...c, id: `COL-${i + 1}` }));
        savedCollections.push(...withIds);
        return withIds;
      }
      if (entity === Income) {
        const arr = Array.isArray(data) ? data : [data];
        savedIncomes.push(...arr);
        return arr;
      }
      if (entity === ShipmentNotInFiles) {
        const arr = Array.isArray(data) ? data : [data];
        savedNoVan.push(...arr);
        return arr;
      }
      return data;
    }),
    update: jest.fn(),
  };

  const queryRunner: any = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager,
  };

  const svc = Object.create(RouteclosureService.prototype) as any;
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.dataSource = { createQueryRunner: () => queryRunner };

  return { svc, savedIncomes, savedCollections, savedNoVan, manager };
}

const subsidiary = { id: 'S1', name: 'Test', fedexCostPackage: 45, dhlCostPackage: 30 };

// ===========================================================================
// (5) Recolecciones del cierre: ingreso salvo ruta 31.5
// ===========================================================================
describe('RouteclosureService.create — (5) recolecciones e is315', () => {
  const dto = {
    packageDispatch: { id: 'PD-1' },
    collections: ['REC-1', 'REC-2'],
    podPackages: [],
    returnedPackages: [],
    noVanPackages: [],
  };

  it('ruta NORMAL (is315=false): guarda las recolecciones Y genera un ingreso por cada una', async () => {
    const packageDispatch = { id: 'PD-1', subsidiary, is315: false, createdAt: new Date('2026-08-10T15:00:00Z') };
    const { svc, savedIncomes, savedCollections } = makeRouteClosureService(packageDispatch);

    await svc.create(dto as any, 'USER-1');

    expect(savedCollections).toHaveLength(2);
    expect(savedIncomes).toHaveLength(2);
    expect(savedIncomes.every((i) => i.sourceType === IncomeSourceType.COLLECTION)).toBe(true);
    expect(savedIncomes.every((i) => Number(i.cost) === 45)).toBe(true);
  });

  it('ruta 31.5 (is315=true): guarda las recolecciones pero NO genera ingreso (regla nueva)', async () => {
    const packageDispatch = { id: 'PD-1', subsidiary, is315: true, createdAt: new Date('2026-08-10T15:00:00Z') };
    const { svc, savedIncomes, savedCollections } = makeRouteClosureService(packageDispatch);

    await svc.create(dto as any, 'USER-1');

    // Las recolecciones se siguen registrando...
    expect(savedCollections).toHaveLength(2);
    expect(savedCollections.map((c) => c.trackingNumber).sort()).toEqual(['REC-1', 'REC-2']);
    // ...pero NO se cobra ninguna.
    expect(savedIncomes.filter((i) => i.sourceType === IncomeSourceType.COLLECTION)).toHaveLength(0);
    expect(savedIncomes).toHaveLength(0);
  });
});

// ===========================================================================
// (1) No VAN: resueltos en FedEx → ingreso si aplican cobro; gate is315
// ===========================================================================
describe('RouteclosureService.create — (1) No VAN → FedEx → ingreso', () => {
  const dtoNoVan = {
    packageDispatch: { id: 'PD-1' },
    collections: [],
    podPackages: [],
    returnedPackages: [],
    noVanPackages: [{ trackingNumber: 'NV-DELIVERED' }, { trackingNumber: 'NV-TRANSIT' }],
  };

  it('is315=false: cobra el No VAN ENTREGADO (FedEx) y NO cobra el que está en tránsito', async () => {
    const packageDispatch = { id: 'PD-1', subsidiary, is315: false, createdAt: new Date('2026-08-10T15:00:00Z') };
    const { svc, savedIncomes, savedNoVan } = makeRouteClosureService(packageDispatch);

    // Estatus FedEx autoritativo por guía (resolveNoVanOutcome es I/O FedEx: se stubea).
    svc.resolveNoVanOutcome = jest.fn(async (tn: string) =>
      tn === 'NV-DELIVERED'
        ? { trackingNumber: tn, delivered: true, dexCode: null, resolved: true }
        : { trackingNumber: tn, delivered: false, dexCode: null, resolved: true }, // en tránsito
    );

    await svc.create(dtoNoVan as any, 'USER-1');

    // Ambos No VAN se registran en shipment_not_in_files...
    expect(savedNoVan).toHaveLength(2);
    // ...pero solo el ENTREGADO genera ingreso (shipment), con costo FedEx.
    const noVanIncomes = savedIncomes.filter((i) => i.sourceType === IncomeSourceType.SHIPMENT);
    expect(noVanIncomes).toHaveLength(1);
    expect(noVanIncomes[0].trackingNumber).toBe('NV-DELIVERED');
    expect(noVanIncomes[0].incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(Number(noVanIncomes[0].cost)).toBe(45);
  });

  it('is315=true: los No VAN se registran pero NO se consultan en FedEx ni cobran', async () => {
    const packageDispatch = { id: 'PD-1', subsidiary, is315: true, createdAt: new Date('2026-08-10T15:00:00Z') };
    const { svc, savedIncomes, savedNoVan } = makeRouteClosureService(packageDispatch);
    svc.resolveNoVanOutcome = jest.fn();

    await svc.create(dtoNoVan as any, 'USER-1');

    expect(savedNoVan).toHaveLength(2);
    expect(svc.resolveNoVanOutcome).not.toHaveBeenCalled();
    expect(savedIncomes).toHaveLength(0);
  });

  it('is315=false: No VAN NO entregado con DEX genera ingreso NO_ENTREGADO con el código', async () => {
    const packageDispatch = { id: 'PD-1', subsidiary, is315: false, createdAt: new Date('2026-08-10T15:00:00Z') };
    const dtoDex = { ...dtoNoVan, noVanPackages: [{ trackingNumber: 'NV-DEX07' }] };
    const { svc, savedIncomes } = makeRouteClosureService(packageDispatch);
    svc.resolveNoVanOutcome = jest.fn(async (tn: string) => ({
      trackingNumber: tn, delivered: false, dexCode: '07', resolved: true,
    }));

    await svc.create(dtoDex as any, 'USER-1');

    const noVanIncomes = savedIncomes.filter((i) => i.sourceType === IncomeSourceType.SHIPMENT);
    expect(noVanIncomes).toHaveLength(1);
    expect(noVanIncomes[0].incomeType).toBe(IncomeStatus.NO_ENTREGADO);
    expect(noVanIncomes[0].nonDeliveryStatus).toBe('07');
  });
});

// ===========================================================================
// (3) Al ABRIR el cierre: reconciliación FedEx que persiste el último estatus
//     (mata el bug de "en_ruta interno gana al estatus real del mismo día").
// ===========================================================================
describe('RouteclosureService.reconcileRouteWithFedex — (3) revalidación FedEx al abrir', () => {
  const subsidiary = { id: 'S1', name: 'Test', fedexCostPackage: 45 };

  function makeService(packageDispatch: any, opts: { outcomes?: any[]; existingByTracking?: Record<string, any[]> } = {}) {
    const outcomes = opts.outcomes ?? [
      { shipmentId: 's1', trackingNumber: 'TN1', applied: true, fromStatus: 'en_ruta', toStatus: ShipmentStatusType.ENTREGADO, insertedEvents: 1, kind: 'shipment', exceptionCode: null, eventAt: '2026-08-12T20:00:00Z' },
    ];
    const applyByRoute = jest.fn().mockResolvedValue(outcomes);
    const savedIncomes: any[] = [];
    const updatedIncomes: any[] = [];
    const incomeRepo = {
      find: jest.fn(async ({ where }: any) => opts.existingByTracking?.[where.trackingNumber] ?? []),
      create: jest.fn((data: any) => data),
      save: jest.fn(async (data: any) => { savedIncomes.push(data); return data; }),
      update: jest.fn(async (id: string, patch: any) => { updatedIncomes.push({ id, patch }); }),
    };
    const svc = Object.create(RouteclosureService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.trackingCompare = { applyByRoute };
    svc.packageDispatchRepository = { findOne: jest.fn().mockResolvedValue(packageDispatch) };
    svc.dataSource = { getRepository: () => incomeRepo };
    return { svc, applyByRoute, incomeRepo, savedIncomes, updatedIncomes };
  }

  it('ruta NORMAL: reconcilia shipments Y F2 (ambos kinds)', async () => {
    const { svc, applyByRoute } = makeService({ id: 'PD-1', is315: false, subsidiary });
    const res = await svc.reconcileRouteWithFedex('PD-1', { userId: 'U1', role: 'operador' });

    expect(applyByRoute).toHaveBeenCalledTimes(1);
    const [routeId, actor, opts] = applyByRoute.mock.calls[0];
    expect(routeId).toBe('PD-1');
    expect(actor).toEqual({ userId: 'U1', role: 'operador' });
    expect(opts.kinds.sort()).toEqual(['charge', 'shipment']);
    expect(res.updated).toBe(1);
  });

  it('ruta 31.5 (is315): SOLO reconcilia los F2 y NO toca ingresos', async () => {
    const { svc, applyByRoute, savedIncomes, updatedIncomes } = makeService({ id: 'PD-1', is315: true, subsidiary });
    const res = await svc.reconcileRouteWithFedex('PD-1', { userId: 'U1', role: 'operador' });

    const [, , opts] = applyByRoute.mock.calls[0];
    expect(opts.kinds).toEqual(['charge']);
    expect(savedIncomes).toHaveLength(0);
    expect(updatedIncomes).toHaveLength(0);
    expect(res.incomeCreated).toBe(0);
  });

  it('backfill: shipment ENTREGADO sin ingreso previo → crea Income SHIPMENT con costo de sucursal', async () => {
    const { svc, savedIncomes } = makeService({ id: 'PD-1', is315: false, subsidiary });
    const res = await svc.reconcileRouteWithFedex('PD-1', { userId: 'U1' });

    expect(savedIncomes).toHaveLength(1);
    expect(savedIncomes[0].incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(savedIncomes[0].sourceType).toBe(IncomeSourceType.SHIPMENT);
    expect(Number(savedIncomes[0].cost)).toBe(45);
    expect(res.incomeCreated).toBe(1);
  });

  it('supersede: existía DEX del MISMO día y ahora está ENTREGADO → actualiza esa fila a ENTREGADO', async () => {
    const { svc, updatedIncomes, savedIncomes } = makeService(
      { id: 'PD-1', is315: false, subsidiary },
      { existingByTracking: { TN1: [{ id: 'INC-DEX', incomeType: IncomeStatus.NO_ENTREGADO, date: new Date('2026-08-12T18:00:00Z') }] } },
    );
    const res = await svc.reconcileRouteWithFedex('PD-1', { userId: 'U1' });

    expect(savedIncomes).toHaveLength(0);
    expect(updatedIncomes).toHaveLength(1);
    expect(updatedIncomes[0].id).toBe('INC-DEX');
    expect(updatedIncomes[0].patch.incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(updatedIncomes[0].patch.nonDeliveryStatus).toBeNull();
    expect(res.incomeSuperseded).toBe(1);
  });

  it('cross-day: DEX de OTRO día + ENTREGADO hoy → conserva el DEX y crea el ENTREGADO', async () => {
    const outcomes = [
      { shipmentId: 's1', trackingNumber: 'TN1', applied: true, fromStatus: 'en_ruta', toStatus: ShipmentStatusType.ENTREGADO, insertedEvents: 1, kind: 'shipment', exceptionCode: null, eventAt: '2026-08-13T20:00:00Z' },
    ];
    const { svc, savedIncomes, updatedIncomes } = makeService(
      { id: 'PD-1', is315: false, subsidiary },
      { outcomes, existingByTracking: { TN1: [{ id: 'INC-DEX', incomeType: IncomeStatus.NO_ENTREGADO, date: new Date('2026-08-12T18:00:00Z') }] } },
    );
    await svc.reconcileRouteWithFedex('PD-1', { userId: 'U1' });

    expect(updatedIncomes).toHaveLength(0); // el DEX se conserva
    expect(savedIncomes).toHaveLength(1);
    expect(savedIncomes[0].incomeType).toBe(IncomeStatus.ENTREGADO);
  });

  it('skip charge: un outcome kind=charge NO genera ni toca ingresos', async () => {
    const outcomes = [
      { shipmentId: 'c9', trackingNumber: 'TN9', applied: true, fromStatus: 'en_ruta', toStatus: ShipmentStatusType.ENTREGADO, insertedEvents: 1, kind: 'charge', exceptionCode: null, eventAt: '2026-08-12T20:00:00Z' },
    ];
    const { svc, savedIncomes } = makeService({ id: 'PD-1', is315: false, subsidiary }, { outcomes });
    await svc.reconcileRouteWithFedex('PD-1', { userId: 'U1' });

    expect(savedIncomes).toHaveLength(0);
  });

  it('despacho inexistente → BadRequestException', async () => {
    const { svc } = makeService(null);
    await expect(svc.reconcileRouteWithFedex('NOPE', {})).rejects.toThrow();
  });
});

// ===========================================================================
// (4) La salida a ruta persiste is315 y routeDate
// ===========================================================================
describe('PackageDispatchService.create — (4) persiste is315 y routeDate', () => {
  function makeDispatchService() {
    let createdDispatch: any = null;

    const qbUpdate: any = {
      update: () => qbUpdate,
      set: () => qbUpdate,
      whereInIds: () => qbUpdate,
      execute: jest.fn(async () => ({ affected: 1 })),
    };
    const qbRelation: any = { relation: () => qbRelation, of: () => qbRelation, add: jest.fn(async () => undefined) };
    const createQueryBuilder = jest.fn(() => {
      // Devuelve un builder que soporta tanto update(...) como relation(...).
      return { ...qbUpdate, ...qbRelation };
    });

    const manager: any = {
      find: jest.fn(async (entity: any) => (entity === Shipment ? [{ id: 'SH-1' }] : [])),
      create: jest.fn((entity: any, data: any) => {
        if (entity === PackageDispatch) {
          createdDispatch = { ...data, id: 'PD-NEW' };
          return createdDispatch;
        }
        return data;
      }),
      save: jest.fn(async (entityOrData: any) => entityOrData),
      createQueryBuilder,
    };

    const queryRunner: any = {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(), manager,
    };

    const svc = Object.create(PackageDispatchService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.dataSource = { createQueryRunner: () => queryRunner };

    return { svc, getCreatedDispatch: () => createdDispatch };
  }

  it('is315=true + routeDate → se ancla a 07:00Z (00:00 Hermosillo) y se guarda is315', async () => {
    const { svc, getCreatedDispatch } = makeDispatchService();

    await svc.create({ shipments: ['SH-1'], is315: true, routeDate: '2026-08-19' } as any, 'USER-1');

    const d = getCreatedDispatch();
    expect(d.is315).toBe(true);
    expect(new Date(d.routeDate).toISOString()).toBe('2026-08-19T07:00:00.000Z');
  });

  it('sin is315 → default false', async () => {
    const { svc, getCreatedDispatch } = makeDispatchService();

    await svc.create({ shipments: ['SH-1'], routeDate: '2026-08-19' } as any, 'USER-1');

    expect(getCreatedDispatch().is315).toBe(false);
  });
});
