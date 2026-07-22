import { TemplatesBootstrapSeeder } from './templates-bootstrap.seeder';
import { EMAIL_TEMPLATE_SEEDS } from './seeds/email-templates.seed';

function repos() {
  const templates: any[] = []; const versions: any[] = []; const vars: any[] = [];
  return {
    tplRepo: {
      findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.code === where.code) ?? null),
      create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }),
      save: (t: any) => { if (!templates.find((x) => x.id === t.id)) templates.push(t); return Promise.resolve(t); },
    },
    verRepo: {
      findOne: ({ where }: any) => Promise.resolve(versions.find((v) => v.templateId === where.templateId && v.version === where.version) ?? null),
      create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }),
      save: (v: any) => { if (!versions.find((x) => x.id === v.id)) versions.push(v); return Promise.resolve(v); },
    },
    varRepo: {
      find: ({ where }: any) => Promise.resolve(vars.filter((x) => x.templateId === where.templateId)),
      create: (d: any) => d,
      save: (arr: any[]) => { vars.push(...arr); return Promise.resolve(arr); },
    },
    _state: { templates, versions, vars },
  };
}

describe('TemplatesBootstrapSeeder', () => {
  const OLD_ENV = process.env.SEED_TEMPLATES_ON_BOOT;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.SEED_TEMPLATES_ON_BOOT;
    else process.env.SEED_TEMPLATES_ON_BOOT = OLD_ENV;
  });

  it('siembra dex03_report (y el resto de correos) con versión publicada en el arranque', async () => {
    delete process.env.SEED_TEMPLATES_ON_BOOT;
    const r = repos();
    const invalidate = jest.fn();
    const seeder = new TemplatesBootstrapSeeder(r.tplRepo as any, r.verRepo as any, r.varRepo as any, { invalidate } as any);
    await seeder.onApplicationBootstrap();

    const dex03 = r._state.templates.find((t: any) => t.code === 'dex03_report');
    expect(dex03).toBeDefined();
    expect(dex03.currentVersionId).toBeTruthy();
    const version = r._state.versions.find((v: any) => v.templateId === dex03.id);
    expect(version.status).toBe('published');
    expect(invalidate).toHaveBeenCalled();
  });

  it('siembra los 12 correos del inventario', async () => {
    const r = repos();
    const seeder = new TemplatesBootstrapSeeder(r.tplRepo as any, r.verRepo as any, r.varRepo as any, { invalidate: jest.fn() } as any);
    await seeder.onApplicationBootstrap();
    const emailTemplates = r._state.templates.filter((t: any) => t.type === 'email');
    expect(emailTemplates.length).toBe(EMAIL_TEMPLATE_SEEDS.length);
  });

  it('NO siembra si SEED_TEMPLATES_ON_BOOT=false (permite desactivarlo)', async () => {
    process.env.SEED_TEMPLATES_ON_BOOT = 'false';
    const r = repos();
    const seeder = new TemplatesBootstrapSeeder(r.tplRepo as any, r.verRepo as any, r.varRepo as any, { invalidate: jest.fn() } as any);
    await seeder.onApplicationBootstrap();
    expect(r._state.templates.length).toBe(0);
  });

  it('es idempotente: dos corridas no duplican plantillas', async () => {
    const r = repos();
    const seeder = new TemplatesBootstrapSeeder(r.tplRepo as any, r.verRepo as any, r.varRepo as any, { invalidate: jest.fn() } as any);
    await seeder.onApplicationBootstrap();
    const countAfterFirst = r._state.templates.length;
    await seeder.onApplicationBootstrap();
    expect(r._state.templates.length).toBe(countAfterFirst);
  });

  it('respeta ediciones del usuario: no pisa un changelog que no empieza con "Seed"', async () => {
    const r = repos();
    const seeder = new TemplatesBootstrapSeeder(r.tplRepo as any, r.verRepo as any, r.varRepo as any, { invalidate: jest.fn() } as any);
    await seeder.onApplicationBootstrap();
    const before = r._state.versions.find((v: any) => v.templateId && v.version === 1 && v.subject?.includes('DEX03'));
    before.designJson = { blocks: [{ id: 'user', type: 'paragraph', text: 'editado por usuario' }] };
    before.changelog = 'Editado manualmente por el usuario';
    await seeder.onApplicationBootstrap();
    const after = r._state.versions.find((v: any) => v.templateId === before.templateId && v.version === 1);
    expect(after.designJson.blocks[0].text).toBe('editado por usuario');
  });

  it('NUNCA tumba el arranque: si un seed lanza, atrapa el error y no propaga', async () => {
    const r = repos();
    r.tplRepo.findOne = () => { throw new Error('DB caída'); };
    const seeder = new TemplatesBootstrapSeeder(r.tplRepo as any, r.verRepo as any, r.varRepo as any, { invalidate: jest.fn() } as any);
    await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
