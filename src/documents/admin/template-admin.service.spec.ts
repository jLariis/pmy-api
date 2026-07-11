import { TemplateAdminService } from './template-admin.service';

function make() {
  const versions: any[] = [];
  const templates: any[] = [{ id: 't1', code: 'c', currentVersionId: null }];
  const tplRepo: any = {
    findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.id === where.id) ?? null),
    create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }),
    save: (t: any) => { const i = templates.findIndex((x) => x.id === t.id); if (i >= 0) templates[i] = t; else templates.push(t); return Promise.resolve(t); },
  };
  const verRepo: any = {
    find: () => Promise.resolve(versions),
    findOne: ({ where }: any) => Promise.resolve(versions.find((v) => v.id === where.id) ?? null),
    create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }),
    save: (v: any) => { const i = versions.findIndex((x) => x.id === v.id); if (i >= 0) versions[i] = v; else versions.push(v); return Promise.resolve(v); },
  };
  const brandRepo: any = { findOne: () => Promise.resolve(null), create: (d: any) => d, save: (b: any) => Promise.resolve({ id: 'b1', ...b }) };
  const store: any = { invalidate: jest.fn() };
  const branding: any = { invalidate: jest.fn() };
  return { svc: new TemplateAdminService(tplRepo, verRepo, brandRepo, store, branding), versions, templates, store, branding };
}

describe('TemplateAdminService', () => {
  it('saveDraft crea la versión 1 como draft', async () => {
    const { svc, versions } = make();
    const v = await svc.saveDraft('t1', { subject: 'S', compiledBody: '<p>x</p>' }, { id: 'u1', name: 'Ana' });
    expect(v.version).toBe(1);
    expect(v.status).toBe('draft');
    expect(versions).toHaveLength(1);
  });

  it('publish setea currentVersionId e invalida caché', async () => {
    const { svc, store, templates } = make();
    const v = await svc.saveDraft('t1', { compiledBody: '<p>x</p>' }, {});
    await svc.publish('t1', v.id, {});
    expect(templates[0].currentVersionId).toBe(v.id);
    expect(store.invalidate).toHaveBeenCalledWith('c');
  });

  it('restore clona una versión previa en un nuevo draft', async () => {
    const { svc } = make();
    const v1 = await svc.saveDraft('t1', { subject: 'Orig', compiledBody: '<p>1</p>' }, {});
    const restored = await svc.restore('t1', v1.id, {});
    expect(restored.subject).toBe('Orig');
    expect(restored.version).toBe(2);
    expect(restored.status).toBe('draft');
  });
});
