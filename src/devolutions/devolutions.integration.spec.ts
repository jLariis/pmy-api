// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque la cadena
// de imports de DevolutionsService lo arrastra (vía ShipmentsService). No lo usamos aquí.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { DevolutionsService } from './devolutions.service';
import { Shipment, ChargeShipment } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('DevolutionsService.renderReturningDocuments', () => {
  const baseInput = { subsidiaryName: 'Obregon', devolutions: [], collections: [] };

  it('usa el motor para pdf y excel', async () => {
    const render = jest.fn()
      .mockResolvedValueOnce({ format: 'pdf', mime: 'application/pdf', buffer: Buffer.from('PDF') })
      .mockResolvedValueOnce({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderReturningDocuments(baseInput);
    expect(render).toHaveBeenNthCalledWith(1, 'returning_pdf', expect.objectContaining({ subsidiaryName: 'Obregon' }));
    expect(render).toHaveBeenNthCalledWith(2, 'returning_excel', expect.any(Object));
    expect(out.pdf?.toString()).toBe('PDF');
    expect(out.excel?.toString()).toBe('XLSX');
  });

  it('sin buffer -> campo undefined (respaldo frontend)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'pdf', mime: 'application/pdf' });
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderReturningDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });

  it('si el motor lanza, no propaga (campos undefined)', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderReturningDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });
});

describe('DevolutionsService.loadReturningInput (privado, vía any)', () => {
  function makeService(subsidiary: any, devolutions: any[], collections: any[]) {
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.subsidiaryRepository = { findOneBy: jest.fn().mockResolvedValue(subsidiary) };
    svc.devolutionRepository = { find: jest.fn().mockResolvedValue(devolutions) };
    svc.collectionRepository = { find: jest.fn().mockResolvedValue(collections) };
    return svc;
  }

  it('mapea devoluciones (reason) y recolecciones (trackingNumber) del día en curso para la sucursal', async () => {
    const svc = makeService(
      { id: 'SUB-1', name: 'Cd. Obregon' },
      [{ trackingNumber: 'D1', reason: '03' }],
      [{ trackingNumber: 'C1' }, { trackingNumber: 'C2' }],
    );
    const input = await svc.loadReturningInput('SUB-1');
    expect(input.subsidiaryName).toBe('Cd. Obregon');
    expect(input.devolutions).toEqual([{ trackingNumber: 'D1', reason: '03' }]);
    expect(input.collections).toEqual([{ trackingNumber: 'C1' }, { trackingNumber: 'C2' }]);
    expect(svc.devolutionRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ subsidiary: { id: 'SUB-1' } }),
    }));
  });

  it('sin devoluciones/recolecciones (gap: no hay sesión/lote persistido) -> arreglos vacíos, no rompe', async () => {
    const svc = makeService({ id: 'SUB-1', name: 'S' }, [], []);
    const input = await svc.loadReturningInput('SUB-1');
    expect(input.devolutions).toEqual([]);
    expect(input.collections).toEqual([]);
  });

  it('sin subsidiary encontrada -> subsidiaryName N/A (no lanza)', async () => {
    const svc = makeService(null, [], []);
    const input = await svc.loadReturningInput('SUB-X');
    expect(input.subsidiaryName).toBe('N/A');
  });
});

describe('DevolutionsService.create — guías en varios consolidados (Bug #1)', () => {
  function makeHarness(opts: {
    shipments: any[];
    charges: any[];
    existingDevolution?: any;
  }) {
    const updates: Array<{ entity: any; id: string; patch: any }> = [];
    const savedEntities: any[] = [];

    const manager = {
      find: jest.fn((entity: any) => {
        if (entity === Shipment) return Promise.resolve(opts.shipments);
        if (entity === ChargeShipment) return Promise.resolve(opts.charges);
        return Promise.resolve([]);
      }),
      findOne: jest.fn(() => Promise.resolve(opts.existingDevolution ?? null)),
      create: jest.fn((entity: any, data: any) => ({ __entity: entity, ...data })),
      save: jest.fn((e: any) => {
        savedEntities.push(e);
        return Promise.resolve(e);
      }),
      update: jest.fn((entity: any, id: string, patch: any) => {
        updates.push({ entity, id, patch });
        return Promise.resolve({ affected: 1 });
      }),
    };

    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager,
    };

    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.dataSource = { createQueryRunner: () => queryRunner };

    return { svc, manager, queryRunner, updates, savedEntities };
  }

  const dto = { trackingNumber: 'T1', subsidiary: { id: 'SUB-1' } } as any;

  it('marca DEVUELTO_A_FEDEX en TODAS las filas (2 shipments de distinto consolidado + 1 charge)', async () => {
    const { svc, updates, savedEntities } = makeHarness({
      shipments: [
        { id: 's-old', consolidatedId: 'CONS-A', status: 'pendiente', createdAt: '2026-08-01' },
        { id: 's-new', consolidatedId: 'CONS-B', status: 'pendiente', createdAt: '2026-08-09' },
      ],
      charges: [{ id: 'c-1', consolidatedId: 'CONS-A', status: 'pendiente', createdAt: '2026-08-05' }],
    });

    const res = await svc.create([dto], 'user-1');

    // Se actualizan las 3 filas a DEVUELTO_A_FEDEX
    expect(updates).toHaveLength(3);
    const updatedIds = updates.map((u) => u.id).sort();
    expect(updatedIds).toEqual(['c-1', 's-new', 's-old']);
    expect(updates.every((u) => u.patch.status === ShipmentStatusType.DEVUELTO_A_FEDEX)).toBe(true);

    // La Devolution se asocia al consolidado del match MÁS RECIENTE (s-new → CONS-B)
    const devolution = savedEntities.find((e) => e.consolidatedId !== undefined && e.date);
    expect(devolution.consolidatedId).toBe('CONS-B');

    expect(res.success).toEqual(['T1']);
    expect(res.notFound).toEqual([]);
  });

  it('con Devolution previa del mismo consolidado: NO duplica el registro pero SÍ garantiza el estatus', async () => {
    const { svc, updates, savedEntities } = makeHarness({
      shipments: [{ id: 's-new', consolidatedId: 'CONS-B', status: 'no_entregado', createdAt: '2026-08-09' }],
      charges: [],
      existingDevolution: { id: 'dev-prev', trackingNumber: 'T1', consolidatedId: 'CONS-B' },
    });

    const res = await svc.create([dto], 'user-1');

    // No se crea una nueva Devolution...
    const createdDevolution = savedEntities.find((e) => e.date && e.consolidatedId !== undefined);
    expect(createdDevolution).toBeUndefined();
    expect(res.duplicates).toEqual(['T1']);
    expect(res.success).toEqual([]);

    // ...pero el estatus del shipment SÍ pasa a DEVUELTO_A_FEDEX (corrección del bug)
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('s-new');
    expect(updates[0].patch.status).toBe(ShipmentStatusType.DEVUELTO_A_FEDEX);
  });

  it('guía inexistente en ambas tablas -> notFound, sin updates', async () => {
    const { svc, updates } = makeHarness({ shipments: [], charges: [] });
    const res = await svc.create([dto], 'user-1');
    expect(res.notFound).toEqual(['T1']);
    expect(updates).toHaveLength(0);
  });

  it('idempotente: fila ya en DEVUELTO_A_FEDEX no se re-actualiza ni agrega historial', async () => {
    const { svc, updates, savedEntities } = makeHarness({
      shipments: [{ id: 's-1', consolidatedId: 'CONS-A', status: ShipmentStatusType.DEVUELTO_A_FEDEX, createdAt: '2026-08-09' }],
      charges: [],
    });
    await svc.create([dto], 'user-1');
    expect(updates).toHaveLength(0);
    // Solo se guarda la Devolution, ningún ShipmentStatus (historial)
    const historyRows = savedEntities.filter((e) => e.timestamp);
    expect(historyRows).toHaveLength(0);
  });
});

describe('DevolutionsService.validateOnShipment — marca wasDispatched (motivo del "Ingreso: No")', () => {
  function makeService(opts: {
    shipments: any[];
    dispatchExists: boolean;
    incomeExists?: boolean;
  }) {
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    svc.fedexStatusResolver = {
      getLatestStatus: jest.fn().mockResolvedValue({ found: false, validation: { ok: true, issues: [] } }),
    };
    svc.shipmentRepository = { find: jest.fn().mockResolvedValue(opts.shipments) };
    svc.chargeShipmentRepository = { findOne: jest.fn().mockResolvedValue(null) };
    svc.incomeRepository = { exists: jest.fn().mockResolvedValue(opts.incomeExists ?? false) };
    svc.packageDispatchHistoryRepository = { exists: jest.fn().mockResolvedValue(opts.dispatchExists) };
    return svc;
  }

  const shipment = {
    id: 's-1',
    trackingNumber: 'T1',
    status: 'devuelto_a_fedex',
    createdAt: '2026-08-20',
    subsidiary: { id: 'SUB-1', name: 'Bodega Hermosillo' },
    statusHistory: [],
  };

  it('shipment sin ingreso que NUNCA salió a ruta -> wasDispatched=false (Bodega Hermosillo)', async () => {
    const svc = makeService({ shipments: [shipment], dispatchExists: false, incomeExists: false });
    const res = await svc.validateOnShipment('T1');
    expect(res.isCharge).toBe(false);
    expect(res.hasIncome).toBe(false);
    expect(res.wasDispatched).toBe(false);
  });

  it('shipment que SÍ salió a ruta -> wasDispatched=true', async () => {
    const svc = makeService({ shipments: [shipment], dispatchExists: true, incomeExists: true });
    const res = await svc.validateOnShipment('T1');
    expect(res.wasDispatched).toBe(true);
    expect(res.hasIncome).toBe(true);
  });

  it('consulta el dispatch contra TODAS las filas de la guía (In(shipmentIds))', async () => {
    const svc = makeService({
      shipments: [shipment, { ...shipment, id: 's-2' }],
      dispatchExists: false,
    });
    await svc.validateOnShipment('T1');
    const arg = svc.packageDispatchHistoryRepository.exists.mock.calls[0][0];
    expect(arg.where.shipment.id._value ?? arg.where.shipment.id.value).toEqual(['s-1', 's-2']);
  });
});

describe('DevolutionsService.sendByEmail — integración con Motor de Plantillas tras flag DOC_ENGINE_RETURNING', () => {
  const OLD_ENV = process.env.DOC_ENGINE_RETURNING;
  afterEach(() => { process.env.DOC_ENGINE_RETURNING = OLD_ENV; });

  function makeService() {
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn() };
    svc.subsidiaryRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 'SUB-1', name: 'Obregon' }) };
    svc.mailService = { sendHighPriorityDevolutionsEmail: jest.fn().mockResolvedValue({ ok: true }) };
    return svc;
  }

  const pdfFile = { buffer: Buffer.from('legacy-pdf') } as any;
  const excelFile = { buffer: Buffer.from('legacy-excel') } as any;

  it('flag OFF (por defecto): usa los archivos subidos tal cual, sin tocar el motor', async () => {
    delete process.env.DOC_ENGINE_RETURNING;
    const svc = makeService();
    svc.renderReturningDocuments = jest.fn();
    await svc.sendByEmail(pdfFile, excelFile, 'Obregon', 'SUB-1');
    expect(svc.renderReturningDocuments).not.toHaveBeenCalled();
    expect(svc.mailService.sendHighPriorityDevolutionsEmail).toHaveBeenCalledWith(pdfFile, excelFile, { id: 'SUB-1', name: 'Obregon' });
  });

  it('flag ON: usa los buffers del motor cuando existen', async () => {
    process.env.DOC_ENGINE_RETURNING = 'true';
    const svc = makeService();
    svc.loadReturningInput = jest.fn().mockResolvedValue({ subsidiaryName: 'Obregon', devolutions: [], collections: [] });
    svc.renderReturningDocuments = jest.fn().mockResolvedValue({ pdf: Buffer.from('PDF'), excel: Buffer.from('XLSX') });
    await svc.sendByEmail(pdfFile, excelFile, 'Obregon', 'SUB-1');
    const [sentPdf, sentExcel] = svc.mailService.sendHighPriorityDevolutionsEmail.mock.calls[0];
    expect(sentPdf.buffer.toString()).toBe('PDF');
    expect(sentExcel.buffer.toString()).toBe('XLSX');
  });

  it('flag ON pero el motor falla: cae a los archivos subidos (no propaga)', async () => {
    process.env.DOC_ENGINE_RETURNING = 'true';
    const svc = makeService();
    svc.loadReturningInput = jest.fn().mockRejectedValue(new Error('boom'));
    await svc.sendByEmail(pdfFile, excelFile, 'Obregon', 'SUB-1');
    const [sentPdf, sentExcel] = svc.mailService.sendHighPriorityDevolutionsEmail.mock.calls[0];
    expect(sentPdf).toBe(pdfFile);
    expect(sentExcel).toBe(excelFile);
  });
});
