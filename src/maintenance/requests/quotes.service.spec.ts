import { BadRequestException, ConflictException } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { RequestsService } from './requests.service';

/** EntityManager falso que registra saves/updates dentro de la "transacción". */
function fakeManager() {
  const saved: any[] = [];
  const updates: any[] = [];
  const m: any = {
    create: jest.fn((_e: any, x: any) => ({ ...x })),
    save: jest.fn(async (_e: any, x: any) => { saved.push(x); return { id: 'new', ...x }; }),
    update: jest.fn(async (e: any, where: any, patch: any) => { updates.push({ entity: e?.name, where, patch }); }),
    query: jest.fn(async () => [{ lastValue: 6 }]),
  };
  return { m, saved, updates };
}

describe('QuotesService', () => {
  const user = { userId: 'u1', role: 'superadmin' };

  it('crear cotización calcula desviación/totales y pasa la solicitud a "en cotización"', async () => {
    const { m, saved, updates } = fakeManager();
    const requests = { loadEditable: jest.fn(async () => ({ id: 'r1', status: 'abierta' })) } as unknown as RequestsService;
    const services: any = { find: jest.fn(async () => [{ id: 's1', referencePrice: 1000 }]) };
    const suppliers: any = { exist: jest.fn(async () => true) };
    const dataSource: any = { transaction: (fn: any) => fn(m) };
    const svc = new QuotesService({} as any, services, suppliers, requests, dataSource, { next: jest.fn() } as any);

    await svc.create('r1', {
      supplierId: 'sup1', quoteDate: '2026-09-22',
      items: [{ serviceId: 's1', description: 'Afinación', quantity: 1, unitPrice: 1200 }],
    }, user);

    expect(saved[0]).toMatchObject({ requestId: 'r1', subtotal: 1200, tax: 192, total: 1392, status: 'capturada' });
    expect(saved[0].items[0]).toMatchObject({ referencePrice: 1000, deviationPct: 20 });
    expect(updates).toContainEqual(expect.objectContaining({ patch: expect.objectContaining({ status: 'en_cotizacion' }) }));
  });

  it('eliminar con orden de compra → 400 (lo decide loadEditable)', async () => {
    const quotes: any = { findOne: jest.fn(async () => ({ id: 'q1', requestId: 'r1' })) };
    const requests = { loadEditable: jest.fn(async () => { throw new BadRequestException('ya tiene orden'); }) } as unknown as RequestsService;
    const svc = new QuotesService(quotes, {} as any, {} as any, requests, {} as any, {} as any);
    await expect(svc.remove('q1', user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('convertir crea OC borrador con partidas copiadas y descarta las hermanas', async () => {
    const { m, saved, updates } = fakeManager();
    const quotes: any = {
      findOne: jest.fn(async () => ({
        id: 'q1', requestId: 'r1', supplierId: 'sup1', notes: null,
        supplier: { contacts: [{ id: 'c1', isDefault: false }, { id: 'c2', isDefault: true }] },
        items: [{ serviceId: 's1', description: 'Frenos', quantity: 1, unitPrice: 1000, taxRate: 0.16, amount: 1000 }],
      })),
    };
    const requests = {
      findOne: jest.fn(async () => ({ id: 'r1', vehicleId: 'v1', subsidiaryId: 'sub1', status: 'en_cotizacion', purchaseOrder: null })),
    } as unknown as RequestsService;
    const folios: any = { next: jest.fn(async () => 'OC-000007') };
    const svc = new QuotesService(quotes, {} as any, {} as any, requests, { transaction: (fn: any) => fn(m) } as any, folios);

    const po: any = await svc.convert('q1', user);
    expect(po).toMatchObject({ folio: 'OC-000007', status: 'borrador', contactId: 'c2', vehicleId: 'v1', total: 1160 });
    expect(saved[0].items[0]).toMatchObject({ description: 'Frenos', approved: true });
    expect(updates.map((u) => u.patch.status)).toEqual(['ganadora', 'descartada', 'orden_generada']);
  });

  it('convertir si ya hay orden → 409', async () => {
    const quotes: any = { findOne: jest.fn(async () => ({ id: 'q1', requestId: 'r1', items: [], supplier: { contacts: [] } })) };
    const requests = { findOne: jest.fn(async () => ({ id: 'r1', purchaseOrder: { folio: 'OC-000001' } })) } as unknown as RequestsService;
    const svc = new QuotesService(quotes, {} as any, {} as any, requests, {} as any, {} as any);
    await expect(svc.convert('q1', user)).rejects.toBeInstanceOf(ConflictException);
  });
});
