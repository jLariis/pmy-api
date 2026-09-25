import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { RequestsService } from './requests.service';

const gerardo = { userId: 'g1', role: 'admin', permissions: ['mttoVehiculos.revisar'] };
const juan = { userId: 'u1', role: 'auxiliar', permissions: [] };

/** EntityManager/DataSource falsos que registran lo guardado. */
function make(opts: { request?: any; hasOrders?: boolean } = {}) {
  const saved: any[] = [];
  const updates: any[] = [];
  const m: any = {
    create: jest.fn((_e: any, x: any) => ({ ...x })),
    save: jest.fn(async (e: any, x: any) => { saved.push({ entity: e?.name, ...x }); return { id: 'new', ...x }; }),
    update: jest.fn(async (e: any, where: any, patch: any) => { updates.push({ entity: e?.name, where, patch }); }),
    find: jest.fn(async () => []),
    createQueryBuilder: jest.fn(() => ({ where: () => ({ getOne: async () => null }) })),
  };
  const dataSource: any = {
    transaction: (fn: any) => fn(m),
    query: jest.fn(async () => [{ productId: 'p1', price: '1000' }]),
    getRepository: jest.fn((e: any) => e?.name === 'PurchaseOrder'
      ? { exist: jest.fn(async () => !!opts.hasOrders) }
      : { findOne: jest.fn(async () => opts.request ?? { id: 'r1', status: 'abierta' }) }),
  };
  const suppliers: any = { exist: jest.fn(async () => true) };
  const svc = new QuotesService({} as any, suppliers, {} as any, {} as unknown as RequestsService, dataSource);
  return { svc, saved, updates, m };
}

const dto = {
  supplierId: 'sup1', quoteDate: '2026-09-24',
  items: [{ requestItemId: 'ri1', productId: 'p1', description: 'Aceite', quantity: 1, unitPrice: 1200, quality: 4 }],
};

describe('QuotesService (v3)', () => {
  it('solo Compras cotiza', async () => {
    await expect(make().svc.create('r1', dto, juan)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no se cotiza una solicitud por revisar ni con órdenes generadas', async () => {
    await expect(make({ request: { id: 'r1', status: 'por_revisar' } }).svc.create('r1', dto, gerardo)).rejects.toThrow(/autoriza la solicitud/);
    await expect(make({ hasOrders: true }).svc.create('r1', dto, gerardo)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('guarda partidas con renglón, impuestos y desviación; actualiza el precio del catálogo y pasa a "en cotización"', async () => {
    const { svc, saved, updates } = make();
    await svc.create('r1', dto, gerardo);
    const quote = saved.find((x) => x.entity === 'MaintenanceQuote');
    expect(quote).toMatchObject({ subtotal: 1200, ieps: 0, tax: 192, total: 1392, status: 'capturada' });
    expect(quote.items[0]).toMatchObject({ requestItemId: 'ri1', referencePrice: 1000, deviationPct: 20, ivaEnabled: true });
    expect(saved.find((x) => x.entity === 'ProductOffer')).toMatchObject({ productId: 'p1', supplierId: 'sup1', price: 1200, quality: 4 });
    expect(updates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceRequest', patch: expect.objectContaining({ status: 'en_cotizacion' }) }));
  });
});
