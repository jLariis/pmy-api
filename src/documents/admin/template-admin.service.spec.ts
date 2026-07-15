import { TemplateAdminService } from './template-admin.service';

function make() {
  const versions: any[] = [];
  const templates: any[] = [
    { id: 't1', code: 'c', currentVersionId: null },
    { id: 't2', code: 'c2', currentVersionId: null },
  ];
  const tplRepo: any = {
    findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.id === where.id) ?? null),
    create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }),
    save: (t: any) => { const i = templates.findIndex((x) => x.id === t.id); if (i >= 0) templates[i] = t; else templates.push(t); return Promise.resolve(t); },
  };
  const verRepo: any = {
    find: () => Promise.resolve(versions),
    findOne: ({ where }: any) =>
      Promise.resolve(
        versions.find((v) => v.id === where.id && (where.templateId === undefined || v.templateId === where.templateId)) ?? null,
      ),
    create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }),
    save: (v: any) => { const i = versions.findIndex((x) => x.id === v.id); if (i >= 0) versions[i] = v; else versions.push(v); return Promise.resolve(v); },
  };
  const brandRepo: any = { findOne: () => Promise.resolve(null), create: (d: any) => d, save: (b: any) => Promise.resolve({ id: 'b1', ...b }) };
  const store: any = { invalidate: jest.fn() };
  const branding: any = { invalidate: jest.fn() };
  const templateService: any = { renderGiven: jest.fn(() => Promise.resolve({ format: 'email', mime: 'text/html', html: '<p>preview</p>', subject: 'Preview' })) };
  return { svc: new TemplateAdminService(tplRepo, verRepo, brandRepo, store, branding, templateService), versions, templates, store, branding, templateService };
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

  it('publish rechaza una versión que pertenece a otra plantilla y no toca currentVersionId', async () => {
    const { svc, templates } = make();
    const foreignVersion = await svc.saveDraft('t2', { compiledBody: '<p>foreign</p>' }, {});
    await expect(svc.publish('t1', foreignVersion.id, {})).rejects.toThrow();
    expect(templates.find((t) => t.id === 't1').currentVersionId).toBeNull();
  });

  it('previewVersion renderiza una versión específica (p.ej. un draft) vía TemplateService.renderGiven', async () => {
    const { svc, templates, templateService } = make();
    const draft = await svc.saveDraft('t1', { subject: 'S', compiledBody: '<p>x</p>' }, {});
    const r = await svc.previewVersion('t1', draft.id, { foo: 'bar' });

    expect(templateService.renderGiven).toHaveBeenCalledWith(
      templates.find((t) => t.id === 't1'),
      draft,
      { foo: 'bar' },
    );
    expect(r.html).toBe('<p>preview</p>');
  });

  it('previewVersion lanza NotFound para una versión de otra plantilla', async () => {
    const { svc } = make();
    const foreignVersion = await svc.saveDraft('t2', { compiledBody: '<p>foreign</p>' }, {});
    await expect(svc.previewVersion('t1', foreignVersion.id, {})).rejects.toThrow();
  });
});
