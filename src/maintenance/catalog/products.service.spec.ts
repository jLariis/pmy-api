import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertUniqueOffers, ProductsService } from './products.service';

describe('ProductsService', () => {
  it('rechaza proveedor repetido con la misma presentación', () => {
    expect(() => assertUniqueOffers([
      { supplierId: 's1', unitId: 'u1', price: 10 },
      { supplierId: 's1', unitId: 'u1', price: 12 },
    ])).toThrow(BadRequestException);
    expect(() => assertUniqueOffers([
      { supplierId: 's1', unitId: 'u1', price: 10 },
      { supplierId: 's1', unitId: 'u2', price: 12 },
    ])).not.toThrow();
  });

  it('categoría duplicada dentro del mismo tipo → 409', async () => {
    const categories: any = { createQueryBuilder: () => ({ where: () => ({ getOne: async () => ({ id: 'x' }) }) }) };
    const svc = new ProductsService({} as any, categories, {} as any, {} as any);
    await expect(svc.saveCategory({ name: 'Balero doble', kind: 'pieza' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('al guardar ofertas marca la fecha de cotización solo si cambió el precio', async () => {
    const before = new Date('2026-01-01');
    const existing: any = { id: 'p1', offers: [{ id: 'o1', price: 100, lastQuotedAt: before }] };
    const products: any = {
      findOne: jest.fn(async () => existing),
      create: jest.fn(() => ({})),
      save: jest.fn(async (e: any) => e),
    };
    const offers: any = { create: jest.fn((x: any) => x) };
    const svc = new ProductsService({} as any, {} as any, products, offers);
    await svc.save({ name: 'Balero', offers: [
      { id: 'o1', supplierId: 's1', price: 100, quality: 4 },
      { supplierId: 's2', price: 90, quality: 3 },
    ] }, 'p1');
    const saved = products.save.mock.calls[0][0];
    expect(saved.offers[0].lastQuotedAt).toBe(before);
    expect(saved.offers[1].lastQuotedAt).toBeInstanceOf(Date);
    expect(saved.offers[1].lastQuotedAt).not.toBe(before);
  });
});
