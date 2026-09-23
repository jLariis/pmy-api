import { ConflictException, NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const qbReturning = (value: any) => ({ where: jest.fn().mockReturnThis(), getOne: jest.fn(async () => value) });

  it('rechaza categoría duplicada (sin importar mayúsculas)', async () => {
    const categories: any = { createQueryBuilder: jest.fn(() => qbReturning({ id: 'c1', name: 'Frenos' })) };
    const svc = new CatalogService(categories, {} as any);
    await expect(svc.createCategory({ name: 'frenos' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('crea categoría nueva', async () => {
    const categories: any = {
      createQueryBuilder: jest.fn(() => qbReturning(null)),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'n', ...x })),
    };
    const svc = new CatalogService(categories, {} as any);
    await expect(svc.createCategory({ name: ' Llantas ' })).resolves.toMatchObject({ name: 'Llantas', active: true });
  });

  it('eliminar servicio es baja lógica', async () => {
    const services: any = { softDelete: jest.fn(async () => ({ affected: 1 })) };
    const svc = new CatalogService({} as any, services);
    await expect(svc.removeService('s1')).resolves.toEqual({ ok: true });
    expect(services.softDelete).toHaveBeenCalledWith('s1');
  });

  it('eliminar servicio inexistente → 404', async () => {
    const services: any = { softDelete: jest.fn(async () => ({ affected: 0 })) };
    await expect(new CatalogService({} as any, services).removeService('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
