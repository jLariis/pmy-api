import { seedEmailTemplates, EMAIL_TEMPLATE_SEEDS } from './email-templates.seed';

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

describe('seedEmailTemplates', () => {
  it('crea una plantilla por cada correo del inventario', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    expect(r._state.templates.length).toBe(EMAIL_TEMPLATE_SEEDS.length);
    expect(r._state.templates.every((t) => t.currentVersionId)).toBe(true);
  });

  it('es idempotente: correrlo dos veces no duplica', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    await seedEmailTemplates(r as any);
    expect(r._state.templates.length).toBe(EMAIL_TEMPLATE_SEEDS.length);
  });

  it('incluye route_dispatch con sus variables', async () => {
    const seed = EMAIL_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch');
    expect(seed).toBeDefined();
    expect(seed!.variables.map((v) => v.name)).toEqual(
      expect.arrayContaining(['subsidiaryName', 'vehicleName', 'createdAt', 'drivers', 'routes', 'trackingNumber']),
    );
  });
});
