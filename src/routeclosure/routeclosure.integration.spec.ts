import { RouteclosureService } from './routeclosure.service';
import { Collection, Income } from 'src/entities';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';

describe('RouteclosureService.create — ingreso por recolección', () => {
  function makeService(packageDispatch: any) {
    const savedIncomes: any[] = [];
    const savedCollections: any[] = [];

    const manager: any = {
      findOne: jest.fn(async (entity: any) => {
        if (entity === Income) return null; // no hay ingreso previo
        return packageDispatch; // PackageDispatch
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

    return { svc, savedIncomes, savedCollections, manager };
  }

  const baseDto = {
    packageDispatch: { id: 'PD-1' },
    collections: ['REC-1', 'REC-2'],
    podPackages: [],
    returnedPackages: [],
    noVanPackages: [],
  };

  it('crea un Income sourceType=collection por cada recolección del cierre', async () => {
    const packageDispatch = {
      id: 'PD-1',
      subsidiary: { id: 'S1', name: 'Test', fedexCostPackage: 45 },
      createdAt: new Date('2026-08-10T15:00:00Z'),
    };
    const { svc, savedIncomes } = makeService(packageDispatch);

    await svc.create(baseDto as any, 'USER-1');

    expect(savedIncomes).toHaveLength(2);
    expect(savedIncomes.every((i) => i.sourceType === IncomeSourceType.COLLECTION)).toBe(true);
    expect(savedIncomes.every((i) => Number(i.cost) === 45)).toBe(true);
    expect(savedIncomes.map((i) => i.trackingNumber).sort()).toEqual(['REC-1', 'REC-2']);
    expect(savedIncomes.every((i) => i.createdById === 'USER-1')).toBe(true);
  });

  it('no duplica el ingreso si la recolección ya tenía Income de collection', async () => {
    const packageDispatch = {
      id: 'PD-1',
      subsidiary: { id: 'S1', name: 'Test', fedexCostPackage: 45 },
      createdAt: new Date('2026-08-10T15:00:00Z'),
    };
    const { svc, savedIncomes, manager } = makeService(packageDispatch);
    // Simular que REC-1 ya tenía ingreso de recolección.
    manager.findOne = jest.fn(async (entity: any, opts: any) => {
      if (entity === Income) {
        return opts?.where?.trackingNumber === 'REC-1' ? { id: 'EXISTING' } : null;
      }
      return packageDispatch;
    });

    await svc.create(baseDto as any, 'USER-1');

    expect(savedIncomes).toHaveLength(1);
    expect(savedIncomes[0].trackingNumber).toBe('REC-2');
  });
});

describe('RouteclosureService.renderRouteClosureDocuments', () => {
  const baseInput = { subsidiaryName: 'Obregon', drivers: [], routes: [], trackingNumber: 'S', allPackages: [], returnedPackages: [], podPackages: [] };

  it('usa el motor para pdf y excel', async () => {
    const render = jest.fn()
      .mockResolvedValueOnce({ format: 'pdf', mime: 'application/pdf', buffer: Buffer.from('PDF') })
      .mockResolvedValueOnce({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = Object.create(RouteclosureService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderRouteClosureDocuments(baseInput);
    expect(render).toHaveBeenNthCalledWith(1, 'route_closure_pdf', expect.objectContaining({ title: 'CIERRE DE RUTA' }));
    expect(render).toHaveBeenNthCalledWith(2, 'route_closure_excel', expect.any(Object));
    expect(out.pdf?.toString()).toBe('PDF');
    expect(out.excel?.toString()).toBe('XLSX');
  });

  it('sin buffer → campo undefined (respaldo frontend)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'pdf', mime: 'application/pdf' }); // sin buffer
    const svc = Object.create(RouteclosureService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderRouteClosureDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });

  it('si el motor lanza, no propaga (campos undefined)', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = Object.create(RouteclosureService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderRouteClosureDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });
});

describe('RouteclosureService.loadRouteClosureInput (privado, vía any)', () => {
  function makeService(closure: any, noVanRows: any[] = []) {
    const svc = Object.create(RouteclosureService.prototype) as any;
    svc.routeClouseRepository = { findOne: jest.fn().mockResolvedValue(closure) };
    svc.dataSource = { getRepository: () => ({ find: jest.fn().mockResolvedValue(noVanRows) }) };
    return svc;
  }

  it('mapea packageDispatch (shipments+chargeShipments con payment) a allPackages', async () => {
    const closure: any = {
      id: 'RC-1',
      actualKms: '250',
      collections: ['REC-1'],
      subsidiary: { name: 'Cd. Obregon' },
      returnedPackages: [],
      podPackages: [],
      packageDispatch: {
        trackingNumber: 'DESP-1', kms: '100', createdAt: new Date('2026-07-18T15:00:00Z'),
        drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }], vehicle: { name: 'ECON-01' },
        subsidiary: { name: 'Fallback Sub' },
        shipments: [
          { trackingNumber: 'A1', shipmentType: 'fedex', payment: { amount: 500, type: 'COD' }, statusHistory: [] },
        ],
        chargeShipments: [
          { trackingNumber: 'A2', shipmentType: 'dhl', payment: null, statusHistory: [] },
        ],
      },
    };
    const svc = makeService(closure);
    const input = await svc.loadRouteClosureInput('RC-1');
    expect(input.subsidiaryName).toBe('Cd. Obregon');
    expect(input.vehicleName).toBe('ECON-01');
    expect(input.kmsInitial).toBe('100');
    expect(input.kmsFinal).toBe('250');
    expect(input.allPackages).toHaveLength(2);
    const a1 = input.allPackages.find((p: any) => p.trackingNumber === 'A1');
    expect(a1.payment).toEqual({ amount: 500, type: 'COD' });
    expect(input.collections).toEqual(['REC-1']);
  });

  it('deriva exceptionCode del statusHistory más reciente en returnedPackages', async () => {
    const closure: any = {
      id: 'RC-1', collections: [], subsidiary: { name: 'S' },
      packageDispatch: { drivers: [], routes: [], shipments: [], chargeShipments: [] },
      returnedPackages: [{
        trackingNumber: 'A2', status: 'direccion_incorrecta',
        statusHistory: [
          { exceptionCode: '07', timestamp: new Date('2026-07-01T00:00:00Z') },
          { exceptionCode: '03', timestamp: new Date('2026-07-10T00:00:00Z') }, // más reciente
        ],
      }],
      podPackages: [],
    };
    const svc = makeService(closure);
    const input = await svc.loadRouteClosureInput('RC-1');
    expect(input.returnedPackages[0].exceptionCode).toBe('03');
  });

  it('carga noVanPackages desde ShipmentNotInFiles por routeClosureId (status desconocido → gap documentado)', async () => {
    const closure: any = {
      id: 'RC-1', collections: [], subsidiary: { name: 'S' },
      packageDispatch: { drivers: [], routes: [], shipments: [], chargeShipments: [] },
      returnedPackages: [], podPackages: [],
    };
    const svc = makeService(closure, [{ trackingNumber: 'X1' }]);
    const input = await svc.loadRouteClosureInput('RC-1');
    expect(input.noVanPackages).toEqual([{ trackingNumber: 'X1', status: 'N/A' }]);
  });

  it('usa subsidiaryName de respaldo del despacho si el cierre no trae subsidiary', async () => {
    const closure: any = {
      id: 'RC-1', collections: [], subsidiary: null,
      packageDispatch: { drivers: [], routes: [], shipments: [], chargeShipments: [], subsidiary: { name: 'Fallback Sub' } },
      returnedPackages: [], podPackages: [],
    };
    const svc = makeService(closure);
    const input = await svc.loadRouteClosureInput('RC-1');
    expect(input.subsidiaryName).toBe('Fallback Sub');
  });
});
