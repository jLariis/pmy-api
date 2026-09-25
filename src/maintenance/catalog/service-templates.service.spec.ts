import { BadRequestException, ConflictException } from '@nestjs/common';
import { ServiceTemplatesService } from './service-templates.service';

function make(opts: { dup?: any; cats?: any[]; used?: boolean } = {}) {
  const saved: any[] = [];
  const deleted: any[] = [];
  const m: any = {
    findOne: jest.fn(async () => ({ id: 's1', active: true })),
    create: jest.fn((_e: any, x: any = {}) => ({ ...x })),
    save: jest.fn(async (e: any, x: any) => { saved.push({ entity: e?.name, x }); return Array.isArray(x) ? x : { id: x.id ?? 's1', ...x }; }),
    delete: jest.fn(async (e: any, where: any) => deleted.push({ entity: e?.name, where })),
  };
  const templates: any = {
    createQueryBuilder: () => ({ where: () => ({ getOne: async () => opts.dup ?? null }) }),
    findOne: jest.fn(async () => ({ id: 's1', name: 'x', items: [] })),
    update: jest.fn(),
  };
  const dataSource: any = {
    transaction: (fn: any) => fn(m),
    getRepository: jest.fn(() => ({
      find: jest.fn(async () => opts.cats ?? [{ id: 'c1', name: 'ACEITE', kind: 'insumo' }, { id: 'c2', name: 'FILTRO', kind: 'pieza' }]),
      exist: jest.fn(async () => !!opts.used),
    })),
  };
  return { svc: new ServiceTemplatesService(templates, dataSource), saved, deleted, templates };
}

const dto = { name: ' Servicio de 10,000 km ', keywords: 'servicio, Servicio, 10 mil', items: [{ categoryId: 'c1', quantity: 5 }, { categoryId: 'c2', quantity: 1 }] };

describe('ServiceTemplatesService', () => {
  it('crea con receta y sinónimos limpios', async () => {
    const { svc, saved } = make();
    await svc.save(dto as any);
    expect(saved[0].x).toMatchObject({ name: 'Servicio de 10,000 km', keywords: 'servicio, 10 mil', active: true });
    expect(saved[1].x.map((i: any) => [i.categoryId, i.quantity, i.sortOrder])).toEqual([['c1', 5, 0], ['c2', 1, 1]]);
  });

  it('al editar reemplaza la receta', async () => {
    const { svc, deleted } = make();
    await svc.save(dto as any, 's1');
    expect(deleted).toContainEqual({ entity: 'ServiceTemplateItem', where: { serviceTemplateId: 's1' } });
  });

  it('rechaza nombre repetido, piezas repetidas y categorías que no son pieza/insumo', async () => {
    await expect(make({ dup: { id: 'otro' } }).svc.save(dto as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(make().svc.save({ ...dto, items: [{ categoryId: 'c1', quantity: 1 }, { categoryId: 'c1', quantity: 2 }] } as any)).rejects.toThrow(/repetido/);
    await expect(make({ cats: [{ id: 'c1', name: 'MANO DE OBRA', kind: 'servicio' }] }).svc.save({ ...dto, items: [{ categoryId: 'c1', quantity: 1 }] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('si ya se usó solo se desactiva', async () => {
    const { svc, templates } = make({ used: true });
    await expect(svc.remove('s1')).resolves.toEqual({ ok: true, deactivated: true });
    expect(templates.update).toHaveBeenCalledWith('s1', expect.objectContaining({ active: false }));
  });
});
