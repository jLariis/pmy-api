import { seedExcelTemplates, EXCEL_TEMPLATE_SEEDS } from './excel-templates.seed';

function repos() {
  const templates: any[] = []; const versions: any[] = []; const vars: any[] = [];
  return {
    tplRepo: { findOne: ({ where }: any) => Promise.resolve(templates.find((t) => t.code === where.code) ?? null), create: (d: any) => ({ id: 't' + (templates.length + 1), ...d }), save: (t: any) => { if (!templates.find((x) => x.id === t.id)) templates.push(t); return Promise.resolve(t); } },
    verRepo: { findOne: ({ where }: any) => Promise.resolve(versions.find((v) => v.templateId === where.templateId && v.version === where.version) ?? null), create: (d: any) => ({ id: 'v' + (versions.length + 1), ...d }), save: (v: any) => { if (!versions.find((x) => x.id === v.id)) versions.push(v); return Promise.resolve(v); } },
    varRepo: { find: ({ where }: any) => Promise.resolve(vars.filter((x) => x.templateId === where.templateId)), create: (d: any) => d, save: (arr: any[]) => { vars.push(...arr); return Promise.resolve(arr); } },
    _state: { templates, versions, vars },
  };
}

describe('seedExcelTemplates', () => {
  it('siembra audit_log_excel como type excel con ExcelDoc (11 columnas)', async () => {
    const r = repos();
    await seedExcelTemplates(r as any);
    const t = r._state.templates.find((x: any) => x.code === 'audit_log_excel');
    expect(t?.type).toBe('excel');
    const v = r._state.versions.find((x: any) => x.templateId === t.id);
    expect(v.designJson.sheets[0].name).toBe('Auditoría');
    expect(v.designJson.sheets[0].columns.length).toBe(11);
  });

  it('es idempotente', async () => {
    const r = repos(); await seedExcelTemplates(r as any); await seedExcelTemplates(r as any);
    expect(r._state.templates.filter((t: any) => t.code === 'audit_log_excel').length).toBe(1);
  });
});
