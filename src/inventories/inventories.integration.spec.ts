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
