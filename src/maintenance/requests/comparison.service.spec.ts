import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ComparisonService } from './comparison.service';

const gerardo = { userId: 'g1', role: 'admin', permissions: ['mttoVehiculos.revisar'] };

const request = {
  id: 'r1', status: 'en_cotizacion', vehicleId: 'v1', subsidiaryId: 's1',
  items: [
    { id: 'ri1', description: 'Aceite', productId: 'p1', quantity: 5, sortOrder: 0, selectedQuoteItemId: null },
    { id: 'ri2', description: 'Balero', productId: null, quantity: 2, sortOrder: 1, selectedQuoteItemId: null },
  ],
};
const quotes = [
  {
    id: 'qA', supplierId: 'sA', notes: null, supplier: { name: 'AutoZone', contacts: [{ id: 'cA', isDefault: true }] },
    items: [
      { id: 'a1', requestItemId: 'ri1', productId: 'p1', description: 'Aceite', quantity: 5, unitPrice: 60, availability: 'si', ivaEnabled: true, iepsEnabled: false, iepsRate: 0, amount: 300 },
      { id: 'a2', requestItemId: 'ri2', description: 'Balero', quantity: 2, unitPrice: 500, availability: 'no', ivaEnabled: true, iepsEnabled: false, iepsRate: 0, amount: 1000 },
    ],
  },
  {
    id: 'qB', supplierId: 'sB', notes: 'entrega mañana', supplier: { name: 'Orealli', contacts: [] },
    items: [
      { id: 'b1', requestItemId: 'ri1', productId: 'p1', description: 'Aceite', quantity: 5, unitPrice: 70, availability: 'si', ivaEnabled: true, iepsEnabled: false, iepsRate: 0, amount: 350 },
      { id: 'b2', requestItemId: 'ri2', description: 'Balero', quantity: 2, unitPrice: 600, availability: 'si', ivaEnabled: true, iepsEnabled: true, iepsRate: 0.08, amount: 1200 },
    ],
  },
];

function make(opts: { hasOrders?: boolean; status?: string } = {}) {
  const saved: any[] = [];
  const updates: any[] = [];
  const m: any = {
    create: jest.fn((_e: any, x: any) => ({ ...x })),
    save: jest.fn(async (e: any, x: any) => { saved.push(x); return { id: `po-${saved.length}`, ...x }; }),
    update: jest.fn(async (e: any, where: any, patch: any) => updates.push({ entity: e?.name, where, patch })),
  };
  const requests: any = { findOne: jest.fn(async () => ({ ...request, status: opts.status ?? request.status })) };
  const quoteRepo: any = { find: jest.fn(async () => quotes) };
  const dataSource: any = { transaction: (fn: any) => fn(m), getRepository: () => ({ exist: jest.fn(async () => !!opts.hasOrders), find: jest.fn(async () => []) }) };
  const folios: any = { next: jest.fn().mockResolvedValueOnce('OC-000001').mockResolvedValueOnce('OC-000002') };
  const orders: any = { submit: jest.fn(async () => undefined) };
  const svc = new ComparisonService(requests, quoteRepo, dataSource, folios, orders, {} as any);
  return { svc, saved, updates, orders };
}

describe('ComparisonService.generateOrders', () => {
  it('una orden por proveedor ganador (el más barato CON existencia en cada renglón) y todas a autorización', async () => {
    const { svc, saved, updates, orders } = make();
    const out = await svc.generateOrders('r1', gerardo);
    expect(out.map((o) => o.folio)).toEqual(['OC-000001', 'OC-000002']);
    // Aceite → AutoZone (60); Balero → Orealli (AutoZone no tiene existencia)
    expect(saved[0]).toMatchObject({ supplierId: 'sA', contactId: 'cA', status: 'borrador', subtotal: 300, total: 348 });
    expect(saved[0].items.map((i: any) => i.description)).toEqual(['Aceite']);
    expect(saved[1]).toMatchObject({ supplierId: 'sB', contactId: null, subtotal: 1200, ieps: 96 });
    expect(saved[1].items[0]).toMatchObject({ requestItemId: 'ri2', iepsEnabled: true, iepsRate: 0.08 });
    expect(orders.submit).toHaveBeenCalledTimes(2);
    expect(updates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceRequest', patch: expect.objectContaining({ status: 'orden_generada' }) }));
  });

  it('con una sola cotización ("Generar orden con esta cotización")', async () => {
    const { svc, saved } = make();
    await svc.generateOrders('r1', gerardo, 'qB');
    expect(saved).toHaveLength(1);
    expect(saved[0].items.map((i: any) => i.description)).toEqual(['Aceite', 'Balero']);
  });

  it('solo Compras; no si ya hay órdenes o no está en cotización', async () => {
    await expect(make().svc.generateOrders('r1', { userId: 'x', role: 'admin', permissions: [] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make({ hasOrders: true }).svc.generateOrders('r1', gerardo)).rejects.toThrow(/ya tiene órdenes/);
    await expect(make({ status: 'por_revisar' }).svc.generateOrders('r1', gerardo)).rejects.toBeInstanceOf(BadRequestException);
  });
});
