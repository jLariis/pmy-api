import { seedExcelTemplates, EXCEL_TEMPLATE_SEEDS } from './excel-templates.seed';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { TemplateEngine } from '../template-engine';
import { buildRouteDispatchData } from '../data/route-dispatch.mapper';
import { buildUnloadingData } from '../data/unloading.mapper';
import { Workbook } from 'exceljs';

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

  it('route_dispatch_excel: fiel a C2 (título naranja, header café, pago amarillo, inválidos)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch_excel')!;
    expect(seed).toBeTruthy();
    const data = buildRouteDispatchData({
      subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }, { name: 'R2' }],
      trackingNumber: 'S1', now: new Date('2026-07-18T20:00:00Z'), createdAt: '2026-07-18T20:00:00Z',
      packages: [
        { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000', recipientPhone: '6620000000', payment: { amount: 500, type: 'COD' }, commitDateTime: '2026-07-18T20:00:00Z' },
        { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000' },
      ],
      invalidTrackings: ['X1', 'X2'],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Despacho')!;
    expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('ef883a');
    let headerRowNum = 0;
    ws.eachRow({ includeEmpty: true }, (r, n) => { if (r.getCell(1).value === 'No.') headerRowNum = n; });
    expect(headerRowNum).toBeGreaterThan(0);
    expect((ws.getRow(headerRowNum).getCell(1).fill as any).fgColor.argb).toBe('8c5e4e');
    let paidFound = false; let invalidFound = false;
    ws.eachRow({ includeEmpty: true }, (r) => {
      if ((r.getCell(1).fill as any)?.fgColor?.argb === 'fff2cc') paidFound = true;
      if (String(r.getCell(1).value).includes('📦 X1')) invalidFound = true;
    });
    expect(paidFound).toBe(true);
    expect(invalidFound).toBe(true);
  });

  it('unloading_excel: fiel a C4 (título naranja, header café, faltantes/sobrantes)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'unloading_excel')!;
    expect(seed).toBeTruthy();
    const data = buildUnloadingData({
      subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', trackingNumber: 'DESEMB-1',
      now: new Date('2026-07-18T20:00:00Z'), createdAt: '2026-07-18T18:30:00Z',
      packages: [
        { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
          recipientPhone: '6620000000', payment: { amount: 500, type: 'COD' }, commitDateTime: '2026-07-18T20:15:00Z' },
        { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000' },
      ],
      missingPackages: ['X1'],
      unScannedTrackings: ['Y1'],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Desembarque')!;
    expect(ws.getCell('A1').value).toBe('📦 Desembarque');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('ef883a');
    let headerRowNum = 0;
    ws.eachRow({ includeEmpty: true }, (r, n) => { if (r.getCell(1).value === 'No.') headerRowNum = n; });
    expect(headerRowNum).toBeGreaterThan(0);
    expect((ws.getRow(headerRowNum).getCell(1).fill as any).fgColor.argb).toBe('8c5e4e');
    let foundMissing = false; let foundUnScanned = false; let foundZebra = false;
    ws.eachRow({ includeEmpty: true }, (r) => {
      if (r.getCell(1).value === '❌ Paquetes faltantes') foundMissing = true;
      if (r.getCell(1).value === '📍 Guías sobrantes') foundUnScanned = true;
      if (String(r.getCell(1).value).includes('X1')) foundMissing = true;
      if (String(r.getCell(1).value).includes('Y1')) foundUnScanned = true;
      if ((r.getCell(1).fill as any)?.fgColor?.argb === 'F2F2F2') foundZebra = true;
    });
    expect(foundMissing).toBe(true);
    expect(foundUnScanned).toBe(true);
    expect(foundZebra).toBe(true);
  });

  it('unloading_excel: sin faltantes ni sobrantes, sus títulos/bandas NO aparecen (fix Lote 2)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'unloading_excel')!;
    const data = buildUnloadingData({
      subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', trackingNumber: 'DESEMB-1',
      now: new Date('2026-07-18T20:00:00Z'), createdAt: '2026-07-18T18:30:00Z',
      packages: [{ trackingNumber: 'T1', recipientName: 'Ana' }],
      missingPackages: [],
      unScannedTrackings: [],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Desembarque')!;
    const values: string[] = [];
    ws.eachRow({ includeEmpty: true }, (r) => values.push(String(r.getCell(1).value)));
    expect(values).not.toContain('❌ Paquetes faltantes');
    expect(values).not.toContain('📍 Guías sobrantes');
  });
});
