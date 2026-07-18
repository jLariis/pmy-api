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

  it('cada correo tiene bloques y la versión sembrada guarda designJson en formato Unlayer', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    expect(EMAIL_TEMPLATE_SEEDS.every((s) => Array.isArray(s.blocks) && s.blocks.length > 0)).toBe(true);
    const v = r._state.versions.find((x: any) => x.designJson);
    expect(v.designJson.body).toBeDefined();
    expect(Array.isArray(v.designJson.body.rows)).toBe(true);
    expect(v.designJson.body.rows.length).toBeGreaterThan(0);
    expect(String(v.compiledBody)).toContain('<mjml');
  });

  it('re-sembrar refresca designJson a Unlayer si el changelog sigue siendo el del seed', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    const before = r._state.versions.find((x: any) => x.templateId && x.version === 1);
    // Simula una plantilla sembrada previamente en el formato viejo { blocks: [...] }
    before.designJson = { blocks: [{ id: 'old', type: 'paragraph', text: 'viejo' }] };
    before.changelog = 'Seed inicial (bloques, paridad con legacy)';
    await seedEmailTemplates(r as any);
    const after = r._state.versions.find((x: any) => x.templateId === before.templateId && x.version === 1);
    expect(after.designJson.body).toBeDefined();
    expect(Array.isArray(after.designJson.body.rows)).toBe(true);
  });

  it('no toca designJson si el changelog indica edición del usuario', async () => {
    const r = repos();
    await seedEmailTemplates(r as any);
    const before = r._state.versions.find((x: any) => x.templateId && x.version === 1);
    before.designJson = { blocks: [{ id: 'user', type: 'paragraph', text: 'editado por usuario' }] };
    before.changelog = 'Editado manualmente por el usuario';
    await seedEmailTemplates(r as any);
    const after = r._state.versions.find((x: any) => x.templateId === before.templateId && x.version === 1);
    expect(after.designJson.blocks).toBeDefined();
    expect(after.designJson.blocks[0].text).toBe('editado por usuario');
  });

  it('route_dispatch conserva sus variables', () => {
    const seed = EMAIL_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch')!;
    expect(seed.variables.map((v) => v.name)).toEqual(
      expect.arrayContaining(['subsidiaryName', 'vehicleName', 'createdAt', 'drivers', 'routes', 'trackingNumber']),
    );
  });
});

const byCode = (c: string) => EMAIL_TEMPLATE_SEEDS.find((s) => s.code === c)!;

describe('EMAIL_TEMPLATE_SEEDS — asuntos y link al sistema', () => {
  const reportCodes = ['route_dispatch', 'unloading', 'route_closure', 'inventory_report', 'devolutions', 'dex03_report'];

  it('route_dispatch incluye chofer y sucursal en el asunto', () => {
    expect(byCode('route_dispatch').subject).toContain('{{driverName}}');
    expect(byCode('route_dispatch').subject).toContain('{{subsidiaryName}}');
  });

  it('todos los reportes declaran la variable detailLink', () => {
    for (const code of reportCodes) {
      const seed = byCode(code);
      expect(seed.variables.some((v) => v.name === 'detailLink')).toBe(true);
    }
  });

  it('todos los reportes tienen un botón "Ver en el sistema" condicionado a detailLink', () => {
    for (const code of reportCodes) {
      const btn = byCode(code).blocks.find((b: any) => b.type === 'button' && b.when === 'detailLink');
      expect(btn).toBeTruthy();
      expect((btn as any).url).toBe('{{detailLink}}');
    }
  });

  it('cierre de ruta declara y muestra el número de seguimiento', () => {
    const seed = byCode('route_closure');
    expect(seed.variables.some((v) => v.name === 'trackingNumber')).toBe(true);
    const kv = seed.blocks.find((b: any) => b.type === 'keyValue') as any;
    expect(kv.items.some((i: any) => i.value === '{{trackingNumber}}')).toBe(true);
  });
});
