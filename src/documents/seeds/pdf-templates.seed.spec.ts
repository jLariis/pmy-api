import { seedPdfTemplates, PDF_TEMPLATE_SEEDS } from './pdf-templates.seed';

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
    varRepo: { find: ({ where }: any) => Promise.resolve(vars.filter((x) => x.templateId === where.templateId)), create: (d: any) => d, save: (arr: any[]) => { vars.push(...arr); return Promise.resolve(arr); } },
    _state: { templates, versions, vars },
  };
}

describe('seedPdfTemplates', () => {
  it('siembra warehouse_dispatch_pdf como type pdf con PdfDoc', async () => {
    const r = repos();
    await seedPdfTemplates(r as any);
    const t = r._state.templates.find((x: any) => x.code === 'warehouse_dispatch_pdf');
    expect(t).toBeDefined();
    expect(t.type).toBe('pdf');
    const v = r._state.versions.find((x: any) => x.templateId === t.id);
    expect(v.designJson.page.orientation).toBe('landscape');
    expect(v.designJson.blocks.some((b: any) => b.type === 'table')).toBe(true);
  });

  it('es idempotente', async () => {
    const r = repos();
    await seedPdfTemplates(r as any); await seedPdfTemplates(r as any);
    expect(r._state.templates.filter((t: any) => t.code === 'warehouse_dispatch_pdf').length).toBe(1);
  });

  it('la tabla incluye la columna HORA condicionada a isHermosillo', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'warehouse_dispatch_pdf')!;
    const table = seed.doc.blocks.find((b: any) => b.type === 'table') as any;
    const hora = table.columns.find((c: any) => c.label === 'HORA');
    expect(hora.hideWhen).toBe('isHermosillo');
  });
});
