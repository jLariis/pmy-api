import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NeedsService } from './needs.service';

const gerardo = { userId: 'g1', role: 'admin', permissions: ['mttoVehiculos.revisar'] };
const juan = { userId: 'u1', role: 'auxiliar', permissions: [] };

const request = {
  id: 'r1', status: 'abierta', vehicleId: 'v1', description: 'Rechina al frenar', items: [],
  services: [{ sortOrder: 0, serviceTemplate: { id: 't1', name: 'Servicio de 10,000 km', keywords: null, items: [{ categoryId: 'ace', quantity: 5, unitId: null, sortOrder: 0 }] } }],
};

function make(opts: { needsCount?: number; existingQuote?: any; itemsInOtherQuotes?: any[]; offerCategory?: string; quotable?: boolean; uncataloged?: any[]; existingProduct?: any } = {}) {
  const savedNeeds: any[] = [];
  const saved: any[] = [];
  const updates: any[] = [];
  const deletes: any[] = [];
  const needs: any = {
    count: jest.fn(async () => opts.needsCount ?? 0),
    save: jest.fn(async (x: any) => { savedNeeds.push(...(Array.isArray(x) ? x : [x])); return x; }),
    create: jest.fn((x: any) => x),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => ({ id: 'n1', requestId: 'r1', categoryId: 'bal', quantity: 1, dismissed: false })),
    update: jest.fn(),
  };
  const requests: any = { findOne: jest.fn(async () => request) };
  const quotes: any = {
    loadQuotable: jest.fn(async () => { if (opts.quotable === false) throw new BadRequestException('Ya se generaron órdenes'); return request; }),
    clearSelections: jest.fn(),
  };
  const repo = (name: string) => ({
    exist: jest.fn(async () => true),
    find: jest.fn(async () => (name === 'ProductCategory'
      ? [{ id: 'bal', name: 'BALATAS', keywords: 'frenos, rechina', kind: 'pieza' }, { id: 'ace', name: 'ACEITE', keywords: null, kind: 'insumo' }]
      : [])),
    findOne: jest.fn(async () => ({ id: 'o1', productId: 'p1', supplierId: 'sA', price: 450, quality: 4, product: { name: 'Balata Brembo', brand: 'Brembo', categoryId: opts.offerCategory ?? 'bal' } })),
  });
  const m: any = {
    createQueryBuilder: jest.fn(() => ({ innerJoin: () => ({ where: () => ({ getMany: async () => opts.itemsInOtherQuotes ?? [] }) }) })),
    findOne: jest.fn(async (e: any, q: any) => (e.name === 'ProductOffer' ? null : e.name === 'MaintenanceQuote' && q.where.supplierId ? opts.existingQuote ?? null : { id: q.where.id, fromCatalog: true })),
    create: jest.fn((_e: any, x: any) => ({ ...x })),
    save: jest.fn(async (e: any, x: any) => { saved.push({ entity: e.name, ...x }); return { id: x.id ?? 'q-new', ...x }; }),
    update: jest.fn(async (e: any, where: any, patch: any) => updates.push({ entity: e.name, where, patch })),
    delete: jest.fn(async (e: any, where: any) => deletes.push({ entity: e.name, where })),
    softDelete: jest.fn(async (e: any, id: any) => deletes.push({ entity: e.name, soft: id })),
    count: jest.fn(async () => 0),
    find: jest.fn(async () => [{ quantity: 1, unitPrice: 450, ivaEnabled: true, iepsEnabled: false, iepsRate: 0, taxRate: 0.16 }]),
  };
  const dataSource: any = { getRepository: jest.fn((e: any) => repo(e.name)), transaction: (fn: any) => fn(m), query: jest.fn(async () => opts.uncataloged ?? []) };
  const qb: any = { innerJoin: () => qb, where: () => qb, getMany: async () => opts.itemsInOtherQuotes ?? [], getOne: async () => opts.existingProduct ?? null };
  m.createQueryBuilder = jest.fn(() => qb);
  const svc = new NeedsService(needs, requests, quotes, dataSource);
  return { svc, savedNeeds, saved, updates, deletes, quotes };
}

describe('NeedsService', () => {
  it('la primera consulta genera la lista (receta + palabras) una sola vez', async () => {
    const a = make({ needsCount: 0 });
    await a.svc.list('r1', gerardo);
    expect(a.savedNeeds.map((n) => [n.categoryId, n.source])).toEqual([['ace', 'receta'], ['bal', 'palabra']]);
    const b = make({ needsCount: 3 });
    await b.svc.list('r1', gerardo);
    expect(b.savedNeeds).toHaveLength(0);
  });

  it('solo Compras (o quien autoriza) la ve', async () => {
    await expect(make().svc.list('r1', juan)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('elegir sugerencia sin cotización del proveedor: crea una "del catálogo" con la partida y totales', async () => {
    const { svc, saved, updates } = make();
    await expect(svc.pick('n1', { offerId: 'o1' }, gerardo)).resolves.toEqual({ quoteId: 'q-new' });
    expect(saved[0]).toMatchObject({ entity: 'MaintenanceQuote', supplierId: 'sA', fromCatalog: true, status: 'capturada' });
    expect(saved[1]).toMatchObject({ entity: 'MaintenanceQuoteItem', requestNeedId: 'n1', productId: 'p1', unitPrice: 450, quality: 4, description: 'Balata Brembo · Brembo', amount: 450 });
    expect(updates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceQuote', patch: expect.objectContaining({ subtotal: 450, tax: 72, total: 522 }) }));
    expect(updates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceRequest', patch: expect.objectContaining({ status: 'en_cotizacion' }) }));
  });

  it('si ya estaba en otra cotización, se quita de ahí (y la del catálogo vacía se borra)', async () => {
    const { svc, deletes, quotes } = make({ existingQuote: { id: 'qA', items: [] }, itemsInOtherQuotes: [{ id: 'old', quoteId: 'qB' }] });
    await svc.pick('n1', { offerId: 'o1' }, gerardo);
    expect(quotes.clearSelections).toHaveBeenCalledWith(expect.anything(), ['old']);
    expect(deletes).toContainEqual(expect.objectContaining({ entity: 'MaintenanceQuoteItem' }));
    expect(deletes).toContainEqual({ entity: 'MaintenanceQuote', soft: 'qB' });
  });

  it('no se puede elegir con órdenes generadas ni un producto de otra pieza', async () => {
    await expect(make({ quotable: false }).svc.pick('n1', { offerId: 'o1' }, gerardo)).rejects.toThrow(/órdenes/);
    await expect(make({ offerCategory: 'otra' }).svc.pick('n1', { offerId: 'o1' }, gerardo)).rejects.toThrow(/no corresponde/);
  });

  it('capturar precio a mano: cotización normal (no del catálogo) y sin producto', async () => {
    const { svc, saved } = make();
    await svc.captureManual('n1', { supplierId: 'sX', description: ' Balata cerámica ', brand: 'Fritec', unitPrice: 399.999, quality: 3 }, gerardo);
    expect(saved[0]).toMatchObject({ entity: 'MaintenanceQuote', supplierId: 'sX', fromCatalog: false });
    expect(saved[1]).toMatchObject({ entity: 'MaintenanceQuoteItem', productId: null, description: 'Balata cerámica · Fritec', unitPrice: 400, quality: 3, requestNeedId: 'n1' });
  });

  it('guardar en el catálogo: crea producto (nombre y marca) y el precio del proveedor, y enlaza la partida', async () => {
    const row = { quoteItemId: 'qi1', description: 'Balata cerámica · Fritec', unitPrice: '400', quality: 3, supplierId: 'sX', supplierName: 'X', categoryId: 'bal', categoryName: 'BALATAS' };
    const { svc, saved, updates } = make({ uncataloged: [row] });
    await expect(svc.saveToCatalog('r1', { quoteItemIds: ['qi1'] }, gerardo)).resolves.toEqual({ saved: 1 });
    expect(saved.find((x) => x.entity === 'Product')).toMatchObject({ name: 'Balata cerámica', brand: 'Fritec', categoryId: 'bal' });
    expect(saved.find((x) => x.entity === 'ProductOffer')).toMatchObject({ supplierId: 'sX', price: 400, quality: 3 });
    expect(updates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceQuoteItem', where: 'qi1' }));
  });
});
