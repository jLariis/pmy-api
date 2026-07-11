import { TemplateStore } from './template-store.service';

function make(template: any, version: any) {
  const tplRepo: any = { findOne: jest.fn(() => Promise.resolve(template)) };
  const verRepo: any = { findOne: jest.fn(() => Promise.resolve(version)) };
  return { svc: new TemplateStore(tplRepo, verRepo), tplRepo, verRepo };
}

describe('TemplateStore', () => {
  it('carga plantilla activa + versión publicada', async () => {
    const { svc } = make(
      { id: 't1', code: 'route_dispatch', active: true, type: 'email', currentVersionId: 'v1' },
      { id: 'v1', status: 'published' },
    );
    const { template, version } = await svc.getActive('route_dispatch');
    expect(template.code).toBe('route_dispatch');
    expect(version.id).toBe('v1');
  });

  it('lanza si la plantilla no existe o está inactiva', async () => {
    const { svc } = make(null, null);
    await expect(svc.getActive('x')).rejects.toThrow();
  });

  it('cachea por code', async () => {
    const { svc, tplRepo } = make(
      { id: 't1', code: 'c', active: true, currentVersionId: 'v1' },
      { id: 'v1', status: 'published' },
    );
    await svc.getActive('c');
    await svc.getActive('c');
    expect(tplRepo.findOne).toHaveBeenCalledTimes(1);
  });
});
