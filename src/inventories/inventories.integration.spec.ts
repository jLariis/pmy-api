import { InventoriesService } from './inventories.service';

describe('InventoriesService.renderInventoryDocuments', () => {
  const baseInput = { subsidiaryName: 'Obregon', packages: [] };

  it('usa el motor para pdf y excel', async () => {
    const render = jest.fn()
      .mockResolvedValueOnce({ format: 'pdf', mime: 'application/pdf', buffer: Buffer.from('PDF') })
      .mockResolvedValueOnce({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderInventoryDocuments(baseInput);
    expect(render).toHaveBeenNthCalledWith(1, 'inventory_pdf', expect.objectContaining({ subsidiaryName: 'Obregon' }));
    expect(render).toHaveBeenNthCalledWith(2, 'inventory_excel', expect.any(Object));
    expect(out.pdf?.toString()).toBe('PDF');
    expect(out.excel?.toString()).toBe('XLSX');
  });

  it('sin buffer → campo undefined (respaldo frontend)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'pdf', mime: 'application/pdf' }); // sin buffer
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderInventoryDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });

  it('si el motor lanza, no propaga (campos undefined)', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderInventoryDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });
});

describe('InventoriesService.loadInventoryInput', () => {
  it('mapea shipments/chargeShipments (con payment) a InventoryInput', () => {
    const svc = Object.create(InventoriesService.prototype) as any;
    const inventory: any = {
      trackingNumber: 'INV-1',
      inventoryDate: new Date('2026-07-18T18:30:00Z'),
      subsidiary: { name: 'Cd. Obregon' },
      shipments: [
        { trackingNumber: 'T1', recipientName: 'Ana', isHighValue: false, payment: { amount: 500, type: 'COD' } },
      ],
      chargeShipments: [
        { trackingNumber: 'T2', recipientName: 'Beto', payment: null },
      ],
    };
    const input = svc.loadInventoryInput(inventory, 'Cd. Obregon (fallback)');
    expect(input.subsidiaryName).toBe('Cd. Obregon');
    expect(input.trackingNumber).toBe('INV-1');
    expect(input.packages).toHaveLength(2);
    const t1 = input.packages.find((p: any) => p.trackingNumber === 'T1');
    const t2 = input.packages.find((p: any) => p.trackingNumber === 'T2');
    expect(t1.isCharge).toBe(false);
    expect(t1.payment).toEqual({ amount: 500, type: 'COD' });
    expect(t2.isCharge).toBe(true);
    expect(t2.payment).toBeNull();
  });

  it('usa subsidiaryName de respaldo si el inventario no trae subsidiary', () => {
    const svc = Object.create(InventoriesService.prototype) as any;
    const inventory: any = { trackingNumber: 'INV-2', shipments: [], chargeShipments: [] };
    const input = svc.loadInventoryInput(inventory, 'Fallback Sub');
    expect(input.subsidiaryName).toBe('Fallback Sub');
  });
});

describe('InventoriesService.renderInventoryNo67Excel', () => {
  const inventoryData = {
    summary: { totalShipments: 4, withoutCode67: 2, withCode67: 2, percentageWithout67: 50 },
    details: [],
  };

  it('usa el motor para el Excel de "Shipments sin código 67"', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.templateService = { render };
    svc.checkInventory67BySubsidiary = jest.fn().mockResolvedValue(inventoryData);
    const buf = await svc.renderInventoryNo67Excel('sub-1');
    expect(svc.checkInventory67BySubsidiary).toHaveBeenCalledWith('sub-1');
    expect(render).toHaveBeenCalledWith('inventory_no67_excel', expect.objectContaining({ totalShipments: 4 }));
    expect(buf?.toString()).toBe('XLSX');
  });

  it('sin buffer → undefined', async () => {
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.templateService = { render: jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }) };
    svc.checkInventory67BySubsidiary = jest.fn().mockResolvedValue(inventoryData);
    const buf = await svc.renderInventoryNo67Excel('sub-1');
    expect(buf).toBeUndefined();
  });
});

describe('InventoriesService.generateExcelReport (flag + fallback)', () => {
  const OLD_ENV = process.env.DOC_ENGINE_INVENTORY_NO67;
  afterEach(() => { process.env.DOC_ENGINE_INVENTORY_NO67 = OLD_ENV; });

  function makeService() {
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return svc;
  }

  it('flag OFF (default): usa directo el armado legacy, sin llamar al motor', async () => {
    delete process.env.DOC_ENGINE_INVENTORY_NO67;
    const svc = makeService();
    const render = jest.fn();
    svc.templateService = { render };
    const legacyBuf = Buffer.from('LEGACY');
    svc.generateExcelReportLegacy = jest.fn().mockResolvedValue(legacyBuf);
    const out = await svc.generateExcelReport('sub-1');
    expect(render).not.toHaveBeenCalled();
    expect(out).toBe(legacyBuf);
  });

  it('flag ON + motor entrega buffer: usa el buffer del motor (no llama al legacy)', async () => {
    process.env.DOC_ENGINE_INVENTORY_NO67 = 'true';
    const svc = makeService();
    svc.checkInventory67BySubsidiary = jest.fn().mockResolvedValue({ summary: {}, details: [] });
    const engineBuf = Buffer.from('ENGINE');
    svc.templateService = { render: jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: engineBuf }) };
    svc.generateExcelReportLegacy = jest.fn().mockResolvedValue(Buffer.from('LEGACY'));
    const out = await svc.generateExcelReport('sub-1');
    expect(out).toBe(engineBuf);
    expect(svc.generateExcelReportLegacy).not.toHaveBeenCalled();
  });

  it('flag ON + motor sin buffer: cae a legacy', async () => {
    process.env.DOC_ENGINE_INVENTORY_NO67 = 'true';
    const svc = makeService();
    svc.checkInventory67BySubsidiary = jest.fn().mockResolvedValue({ summary: {}, details: [] });
    svc.templateService = { render: jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }) };
    const legacyBuf = Buffer.from('LEGACY');
    svc.generateExcelReportLegacy = jest.fn().mockResolvedValue(legacyBuf);
    const out = await svc.generateExcelReport('sub-1');
    expect(out).toBe(legacyBuf);
  });

  it('flag ON + motor lanza: no propaga, cae a legacy', async () => {
    process.env.DOC_ENGINE_INVENTORY_NO67 = 'true';
    const svc = makeService();
    svc.checkInventory67BySubsidiary = jest.fn().mockRejectedValue(new Error('boom'));
    svc.templateService = { render: jest.fn() };
    const legacyBuf = Buffer.from('LEGACY');
    svc.generateExcelReportLegacy = jest.fn().mockResolvedValue(legacyBuf);
    const out = await svc.generateExcelReport('sub-1');
    expect(out).toBe(legacyBuf);
    expect(svc.logger.warn).toHaveBeenCalled();
  });
});

describe('InventoriesService.create — tipo y guías no incluidas', () => {
  const makeSvc = (opts: { shipments?: any[] } = {}) => {
    const created: any[] = [];
    const manager = {
      findBy: jest.fn().mockResolvedValue([]),
      find: jest.fn(async (entity: any) => (entity?.name === 'Shipment' ? opts.shipments ?? [] : [])),
      findOneBy: jest.fn().mockResolvedValue({ id: 'sub-1', name: 'Bodega Obregon' }),
      create: jest.fn((_e: any, data: any) => { created.push(data); return data; }),
      save: jest.fn(async (x: any) => ({ id: 'inv-1', ...x })),
    };
    const qr = {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(), manager,
      query: jest.fn().mockResolvedValue(undefined),
    };
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.dataSource = { createQueryRunner: () => qr };
    svc.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    return { svc, created, qr };
  };

  it('guarda el tipo que manda el front como `inventoryType` (antes todo quedaba "initial")', async () => {
    const { svc, created } = makeSvc();
    await svc.create({ shipments: [], chargeShipments: [], subsidiary: { id: 'sub-1' }, inventoryType: 'dex' }, 'u1');
    expect(created[0]).toEqual(expect.objectContaining({ type: 'dex' }));
  });

  it('guarda las guías no incluidas con su motivo; tipo inválido cae a "initial"', async () => {
    const { svc, created } = makeSvc();
    await svc.create({
      shipments: [], chargeShipments: [], subsidiary: { id: 'sub-1' }, type: 'otro',
      rejectedTrackings: [{ trackingNumber: ' 123 ', reason: 'No existe', kind: 'no_encontrada' }, { trackingNumber: '' }],
    });
    expect(created[0].type).toBe('initial');
    expect(created[0].rejectedTrackings).toEqual([{ trackingNumber: '123', reason: 'No existe', kind: 'no_encontrada' }]);
  });

  it('rechaza paquetes de otra sucursal y no guarda nada', async () => {
    const { svc, created } = makeSvc({
      shipments: [
        { id: 's1', trackingNumber: '111', status: 'en_bodega', subsidiary: { id: 'sub-1' } },
        { id: 's2', trackingNumber: '222', status: 'en_bodega', subsidiary: { id: 'sub-OTRA' } },
      ],
    });
    await expect(
      svc.create({ shipments: ['s1', 's2'], chargeShipments: [], subsidiary: { id: 'sub-1' } }, 'u1'),
    ).rejects.toThrow('Estas guías son de otra sucursal: 222');
    expect(created).toHaveLength(0);
  });

  it('marca el historial del inventario con source=inventory (no es movimiento)', async () => {
    const { svc, created } = makeSvc({
      shipments: [{ id: 's1', trackingNumber: '111', status: 'en_bodega', subsidiary: { id: 'sub-1' } }],
    });
    await svc.create({ shipments: ['s1'], chargeShipments: [], subsidiary: { id: 'sub-1' } }, 'u1');
    const history = created.filter((c) => c.notes?.includes('inventario físico'));
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('inventory');
  });

  it('guarda el estatus de cada paquete al momento del inventario (mig 122)', async () => {
    const { svc, qr } = makeSvc({
      shipments: [{ id: 's1', trackingNumber: '111', status: 'en_bodega', subsidiary: { id: 'sub-1' } }],
    });
    await svc.create({ shipments: ['s1'], chargeShipments: [], subsidiary: { id: 'sub-1' } }, 'u1');
    expect(qr.query).toHaveBeenCalledWith(expect.stringContaining('SET j.statusAtInventory = s.status'), ['inv-1']);
  });

  it('si falta la migración 122, el inventario se guarda igual', async () => {
    const { svc, qr } = makeSvc({
      shipments: [{ id: 's1', trackingNumber: '111', status: 'en_bodega', subsidiary: { id: 'sub-1' } }],
    });
    qr.query.mockRejectedValueOnce(new Error("Unknown column 'statusAtInventory'"));
    await expect(svc.create({ shipments: ['s1'], chargeShipments: [], subsidiary: { id: 'sub-1' } }, 'u1')).resolves.toEqual(
      expect.objectContaining({ id: 'inv-1' }),
    );
    expect(qr.commitTransaction).toHaveBeenCalled();
  });
});
