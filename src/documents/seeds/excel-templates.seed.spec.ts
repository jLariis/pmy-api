import { seedExcelTemplates, EXCEL_TEMPLATE_SEEDS } from './excel-templates.seed';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { TemplateEngine } from '../template-engine';
import { buildRouteDispatchData } from '../data/route-dispatch.mapper';
import { buildUnloadingData } from '../data/unloading.mapper';
import { buildInventoryData } from '../data/inventory.mapper';
import { buildRouteClosureData } from '../data/route-closure.mapper';
import { buildReturningData } from '../data/returning.mapper';
import { buildWarehouseExcelData } from '../../warehouse/warehouse.service';
import { buildDriverReportData } from '../data/driver-report.mapper';
import { buildIncomeStatementData } from '../data/income-statement.mapper';
import { buildInventoryNo67Data } from '../data/inventory-no67.mapper';
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

  it('inventory_excel: fiel a C6 (título naranja, header café, celular, faltantes/sin-escaneo)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_excel')!;
    expect(seed).toBeTruthy();
    const data = buildInventoryData({
      subsidiaryName: 'Cd. Obregon', trackingNumber: 'INV-1',
      inventoryDate: '2026-07-18T18:30:00Z', now: new Date('2026-07-18T20:00:00Z'),
      packages: [
        { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
          recipientPhone: '6620000000', payment: { amount: 500, type: 'COD' }, commitDateTime: '2026-07-18T20:15:00Z' },
        { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000' },
      ],
      missingTrackings: ['X1'],
      unScannedTrackings: ['Y1'],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Inventario')!;
    expect(ws.getCell('A1').value).toBe('📦 Inventario');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('ef883a');
    let headerRowNum = 0;
    ws.eachRow({ includeEmpty: true }, (r, n) => { if (r.getCell(1).value === 'No.') headerRowNum = n; });
    expect(headerRowNum).toBeGreaterThan(0);
    expect((ws.getRow(headerRowNum).getCell(1).fill as any).fgColor.argb).toBe('8c5e4e');
    expect(ws.getRow(headerRowNum).getCell(9).value).toBe('Celular');
    let foundMissing = false; let foundUnScanned = false; let foundZebra = false; let foundPayment = false;
    ws.eachRow({ includeEmpty: true }, (r) => {
      if (r.getCell(1).value === '❌ Missing Trackings') foundMissing = true;
      if (r.getCell(1).value === '📍 UnScanned Trackings') foundUnScanned = true;
      if (String(r.getCell(1).value).includes('X1')) foundMissing = true;
      if (String(r.getCell(1).value).includes('Y1')) foundUnScanned = true;
      if ((r.getCell(1).fill as any)?.fgColor?.argb === 'F2F2F2') foundZebra = true;
      if (r.getCell(6).value === 'COD $500') foundPayment = true; // crudo, sin Intl
    });
    expect(foundMissing).toBe(true);
    expect(foundUnScanned).toBe(true);
    expect(foundZebra).toBe(true);
    expect(foundPayment).toBe(true);
  });

  it('inventory_excel: sin faltantes ni sin-escaneo, sus títulos/bandas NO aparecen (secciones `when`)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_excel')!;
    const data = buildInventoryData({
      subsidiaryName: 'Cd. Obregon', packages: [{ trackingNumber: 'T1', recipientName: 'Ana' }],
      missingTrackings: [], unScannedTrackings: [],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Inventario')!;
    const values: string[] = [];
    ws.eachRow({ includeEmpty: true }, (r) => values.push(String(r.getCell(1).value)));
    expect(values).not.toContain('❌ Missing Trackings');
    expect(values).not.toContain('📍 UnScanned Trackings');
  });

  it('route_closure_excel: fiel a C8 (título, 6 secciones, headers café, totales gris)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'route_closure_excel')!;
    expect(seed).toBeTruthy();
    const data = buildRouteClosureData({
      subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }],
      trackingNumber: 'DESP-1', kmsInitial: '100', kmsFinal: '250', dispatchCreatedAt: '2026-07-18T15:00:00Z',
      now: new Date('2026-07-18T20:00:00Z'),
      allPackages: [
        { trackingNumber: 'A1', shipmentType: 'fedex' },
        { trackingNumber: 'A2', shipmentType: 'dhl', status: 'direccion_incorrecta', exceptionCode: '03', payment: { amount: 200, type: 'COD' } },
      ],
      returnedPackages: [{ trackingNumber: 'A2', shipmentType: 'dhl', status: 'direccion_incorrecta', exceptionCode: '03', recipientName: 'Ana' }],
      podPackages: [{ trackingNumber: 'A1', shipmentType: 'fedex', payment: { amount: 500, type: 'COD' } }],
      collections: ['REC-1'],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Cierre de Ruta')!;
    expect(ws.getCell('A1').value).toBe('📋 CIERRE DE RUTA');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('8c5e4e');

    const values: { row: number; v: any; fill?: string }[] = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      values.push({ row: n, v: r.getCell(1).value, fill: (r.getCell(1).fill as any)?.fgColor?.argb });
    });
    const find = (v: string) => values.find((x) => x.v === v);
    // Título de sección: coincide con el texto Y con el fill 8c5e4e (algunos textos, p.ej.
    // "PAQUETES DEVUELTOS", se repiten como etiqueta de fila dentro de ESTADÍSTICAS —fiel al
    // frontend original— así que se busca la ocurrencia con el fill de título, no la primera).
    const findTitle = (v: string) => values.find((x) => x.v === v && x.fill === '8c5e4e');

    // Títulos de sección (naranja/café primario 8c5e4e)
    for (const title of ['INFORMACIÓN GENERAL', 'ESTADÍSTICAS', 'PAQUETES DEVUELTOS', 'CONTEO POR CÓDIGO DEX', 'RECOLECCIONES', 'COBROS']) {
      expect(findTitle(title)).toBeTruthy();
    }
    // Headers de tabla (café secundario 6d4c41)
    for (const header of ['CAMPO', 'ESTADÍSTICA', 'No.', 'CÓDIGO DEX']) {
      expect(find(header)?.fill).toBe('6d4c41');
    }
    // Totales (gris E8E8E8)
    expect(values.some((x) => String(x.v).includes('TOTAL DEVOLUCIONES: 1') && x.fill === 'E8E8E8')).toBe(true);
    expect(find('TOTAL DEVOLUCIONES')?.fill).toBe('E8E8E8'); // fila del conteo DEX
    expect(find('TOTAL RECOLECCIONES')?.fill).toBe('E8E8E8');
    expect(find('TOTAL COBROS')?.fill).toBe('E8E8E8');

    // Datos de negocio presentes (GUÍA está en la columna 2 de estas tablas)
    let foundA2 = false; let foundRec1 = false;
    ws.eachRow({ includeEmpty: true }, (r) => {
      if (r.getCell(2).value === 'A2') foundA2 = true;
      if (r.getCell(2).value === 'REC-1') foundRec1 = true;
    });
    expect(foundA2).toBe(true); // guía devuelta
    expect(foundRec1).toBe(true); // recolección
  });

  it('route_closure_excel: sin devueltos/recolecciones/cobros, sus títulos/tablas NO aparecen (`when`)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'route_closure_excel')!;
    const data = buildRouteClosureData({
      subsidiaryName: 'S', drivers: [], routes: [], trackingNumber: 'T',
      allPackages: [], returnedPackages: [], podPackages: [],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Cierre de Ruta')!;
    const values: { v: any; fill?: string }[] = [];
    ws.eachRow({ includeEmpty: true }, (r) => values.push({ v: String(r.getCell(1).value), fill: (r.getCell(1).fill as any)?.fgColor?.argb }));
    // "PAQUETES DEVUELTOS" sigue apareciendo como etiqueta de fila en ESTADÍSTICAS (incondicional),
    // pero el TÍTULO de sección (fill 8c5e4e) de la tabla de devueltos debe estar ausente.
    expect(values.some((x) => x.v === 'PAQUETES DEVUELTOS' && x.fill === '8c5e4e')).toBe(false);
    expect(values.some((x) => x.v === 'RECOLECCIONES')).toBe(false);
    expect(values.some((x) => x.v === 'COBROS')).toBe(false);
    // Secciones incondicionales siempre presentes
    const plain = values.map((x) => x.v);
    expect(plain).toContain('INFORMACIÓN GENERAL');
    expect(plain).toContain('ESTADÍSTICAS');
    expect(plain).toContain('CONTEO POR CÓDIGO DEX');
  });

  it('returning_excel: fiel a C10 (título, localidad, fecha, resumen fila5, tablas espejo A:C/F:H, leyenda)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'returning_excel')!;
    expect(seed).toBeTruthy();
    const data = buildReturningData({
      subsidiaryName: 'Cd. Obregon',
      now: new Date('2026-07-22T18:00:00Z'),
      devolutions: [{ trackingNumber: 'D1', reason: '03' }, { trackingNumber: 'D2', reason: 'otro' }],
      collections: [{ trackingNumber: 'C1' }],
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Reporte')!;

    // Título + localidad + fecha
    expect(ws.getCell('A1').value).toBe('FedEx - Devoluciones y Recolecciones');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('662D91');
    expect(ws.getCell('A2').value).toBe('LOCALIDAD: CD. OBREGON');
    expect(ws.getCell('A3').value).toBe('22/07/2026');

    // Resumen fila 5 (columnas específicas, no contiguas)
    const row5 = ws.getRow(5);
    expect(row5.getCell(1).value).toBe('TOTAL RECOLECCIONES:');
    expect(row5.getCell(2).value).toBe(1);
    expect(row5.getCell(3).value).toBe('TOTAL DEVOLUCIONES:');
    expect(row5.getCell(4).value).toBe(2);
    expect(row5.getCell(6).value).toBe('TOTAL GENERAL:');
    expect(row5.getCell(7).value).toBe(3);

    // Tablas espejo fila 7 (títulos) / fila 8 (encabezados) / fila 9+ (datos)
    expect(ws.getCell(7, 1).value).toBe('DEVOLUCIONES');
    expect((ws.getCell(7, 1).fill as any).fgColor.argb).toBe('662D91');
    expect(ws.getCell(7, 6).value).toBe('RECOLECCIONES');
    expect((ws.getCell(7, 6).fill as any).fgColor.argb).toBe('FF6600');
    expect(ws.getCell(8, 1).value).toBe('No.');
    expect(ws.getCell(8, 2).value).toBe('GUIA');
    expect(ws.getCell(8, 3).value).toBe('MOTIVO');
    expect(ws.getCell(8, 6).value).toBe('GUIA');
    expect(ws.getCell(8, 7).value).toBe('SUCURSAL');
    expect(ws.getCell(8, 8).value).toBe('No.');

    expect(ws.getCell(9, 2).value).toBe('D1');
    expect(ws.getCell(9, 3).value).toBe('DEX03');
    expect(ws.getCell(9, 3).font?.color?.argb).toBe('FF0000'); // MOTIVO con DEX -> rojo
    expect(ws.getCell(10, 2).value).toBe('D2');
    expect(ws.getCell(10, 3).value).toBe('OTRO'); // fallback: no matchea código -> tal cual
    expect(ws.getCell(10, 3).font?.color?.argb).toBeUndefined();
    expect(ws.getCell(9, 6).value).toBe('C1');
    expect(ws.getCell(9, 7).value).toBe('CD.');
    // Guías con formato texto ('@'), fiel al frontend
    expect(ws.getColumn(2).numFmt).toBe('@');
    expect(ws.getColumn(6).numFmt).toBe('@');

    // Leyenda DEX (centrada, en cursiva, después de las tablas)
    const values: { v: any; italic?: boolean; align?: string }[] = [];
    ws.eachRow({ includeEmpty: true }, (r) => values.push({ v: r.getCell(1).value, italic: r.getCell(1).font?.italic, align: r.getCell(1).alignment?.horizontal }));
    const legend = values.find((x) => String(x.v).startsWith('DEX 03'));
    expect(legend).toBeTruthy();
    expect(legend?.italic).toBe(true);
    expect(legend?.align).toBe('center');
    expect(values.some((x) => String(x.v).startsWith('DEX 17'))).toBe(true);
  });

  it('warehouse_dispatch_excel: fiel a B2 (título naranja, info rows, header naranja, 9 cols w18)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'warehouse_dispatch_excel')!;
    expect(seed).toBeTruthy();
    const data = buildWarehouseExcelData(
      {
        title: 'Salida a Ruta', routes: [{ name: 'R1' }, { name: 'R2' }],
        drivers: [{ name: 'Juan' }], vehicle: { name: 'ECON-01' },
      },
      [
        { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000', recipientPhone: '6620000000', isCharge: true, payment: { amount: 500 } },
        { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000', isCharge: false },
      ],
      'America/Hermosillo',
    );
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Despacho')!;
    expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('ef883a');

    const values: { row: number; v: any }[] = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => values.push({ row: n, v: r.getCell(1).value }));
    expect(values.some((x) => String(x.v) === 'Ruta: R1 -> R2')).toBe(true);
    expect(values.some((x) => String(x.v) === 'Conductores: Juan')).toBe(true);
    expect(values.some((x) => String(x.v) === 'Unidad: ECON-01')).toBe(true);
    expect(values.some((x) => String(x.v).startsWith('Fecha: '))).toBe(true);
    expect(values.some((x) => String(x.v) === 'Paquetes: 2')).toBe(true);

    let headerRowNum = 0;
    ws.eachRow({ includeEmpty: true }, (r, n) => { if (r.getCell(1).value === 'No.') headerRowNum = n; });
    expect(headerRowNum).toBeGreaterThan(0);
    const headerRow = ws.getRow(headerRowNum);
    expect((headerRow.getCell(1).fill as any).fgColor.argb).toBe('ef883a');
    expect(headerRow.getCell(1).font?.bold).toBe(true);
    expect(headerRow.getCell(1).alignment?.horizontal).toBe('center');
    const labels = ['No.', 'Guía', 'Recibe', 'Dirección', 'CP', 'Cobro', 'Fecha', 'Teléfono', 'Firma'];
    labels.forEach((l, i) => expect(headerRow.getCell(i + 1).value).toBe(l));
    for (let c = 1; c <= 9; c++) expect(ws.getColumn(c).width).toBe(18);

    const dataRow = ws.getRow(headerRowNum + 1);
    expect(dataRow.getCell(1).value).toBe(1);
    expect(dataRow.getCell(2).value).toBe('T1');
    expect(dataRow.getCell(3).value).toBe('Ana');
    expect(dataRow.getCell(6).value).toBe(500);
    expect(ws.getRow(headerRowNum + 2).getCell(6).value).toBe('N/A');
  });

  it('driver_report_excel: fiel a B3 (título/subtítulo, cabeceras, semáforo por celda, totales, hoja 2 con DEX rojo)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'driver_report_excel')!;
    expect(seed).toBeTruthy();
    const data = buildDriverReportData({
      startDate: '2026-07-01T06:00:00.000Z', endDate: '2026-07-20T06:00:00.000Z',
      summaryData: [
        { driverName: 'Juan Pérez', total: '10', delivered: '9', returned: '1', dex03: '0', dex07: '1', dex08: '0', pending: '0', fechaRequested: '0', returnedFedex: '0', unmapped: '0' },
        { driverName: 'Ana López', total: '10', delivered: '5', returned: '4', dex03: '2', dex07: '1', dex08: '1', pending: '1', fechaRequested: '0', returnedFedex: '0', unmapped: '0' },
      ],
      detailsData: [
        { driverName: 'Juan Pérez', routeName: 'R1', subsidiaryName: 'Obregón', tracking: 'T1', status: 'entregado', realstatus: 'entregado', exceptionCode: '-', commitDate: '2026-07-20T10:00:00Z', cp: '85000', recipient: 'Cliente 1' },
        { driverName: 'Ana López', routeName: 'R2', subsidiaryName: 'Obregón', tracking: 'T2', status: 'devuelto_a_fedex', realstatus: 'direccion_incorrecta', exceptionCode: '03', commitDate: null, cp: '', recipient: '' },
      ],
    });
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);

    // Hoja 1
    const ws1 = wb.getWorksheet('Eficiencia Operativa')!;
    expect(ws1).toBeTruthy();
    expect(ws1.views?.[0]?.showGridLines).toBe(false);
    expect(ws1.getCell('A1').value).toBe('📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA');
    expect((ws1.getCell('A1').fill as any).fgColor.argb).toBe('0F172A');
    expect(String(ws1.getCell('A2').value)).toBe('Periodo Analizado: 2026-07-01 al 2026-07-20');

    let headerRowNum = 0;
    ws1.eachRow({ includeEmpty: true }, (r, n) => { if (r.getCell(1).value === 'Chofer / Repartidor') headerRowNum = n; });
    expect(headerRowNum).toBeGreaterThan(0);
    const headerRow1 = ws1.getRow(headerRowNum);
    expect((headerRow1.getCell(1).fill as any).fgColor.argb).toBe('2563EB');
    expect(headerRow1.getCell(1).border?.top?.style).toBe('medium');
    expect(headerRow1.getCell(12).value).toBe('% Efectividad');
    expect(headerRow1.getCell(13).value).toBe('% Retorno');

    const juanRow = ws1.getRow(headerRowNum + 1);
    expect(juanRow.getCell(1).value).toBe('Juan Pérez');
    expect((juanRow.getCell(12).fill as any).fgColor.argb).toBe('059669'); // 90% -> verde
    expect((juanRow.getCell(13).fill as any).fgColor.argb).toBe('D97706'); // 10% retorno -> ámbar

    const anaRow = ws1.getRow(headerRowNum + 2);
    expect((anaRow.getCell(12).fill as any).fgColor.argb).toBe('E11D48'); // 50% -> rojo
    expect((anaRow.getCell(13).fill as any).fgColor.argb).toBe('E11D48'); // 40% retorno -> rojo

    const totalsRow = ws1.getRow(headerRowNum + 3);
    expect(totalsRow.getCell(1).value).toBe('TOTALES GLOBALES');
    expect((totalsRow.getCell(1).fill as any).fgColor.argb).toBe('E2E8F0');
    expect(totalsRow.getCell(1).border?.top?.style).toBe('double');

    // Hoja 2
    const ws2 = wb.getWorksheet('Detalle de Paquetes')!;
    expect(ws2).toBeTruthy();
    const header2 = ws2.getRow(1);
    expect((header2.getCell(1).fill as any).fgColor.argb).toBe('475569');
    expect(header2.getCell(5).value).toBe('Estatus');
    const dataRow2 = ws2.getRow(3); // fila 2 = Juan (DEX '-'), fila 3 = Ana (DEX '03', rojo)
    expect(dataRow2.getCell(6).value).toBe('03');
    expect(dataRow2.getCell(6).font?.color?.argb).toBe('E11D48');
    expect(dataRow2.getCell(6).font?.bold).toBe(true);
    const dataRow1 = ws2.getRow(2);
    expect(dataRow1.getCell(6).value).toBe('-');
    expect(dataRow1.getCell(6).font?.color?.argb).toBeUndefined();
  });

  it('returning_excel: sin devoluciones ni recolecciones, tablas espejo quedan solo con título+encabezado (0/0/0)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'returning_excel')!;
    const data = buildReturningData({ subsidiaryName: 'S', devolutions: [], collections: [] } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Reporte')!;
    const row5 = ws.getRow(5);
    expect(row5.getCell(2).value).toBe(0);
    expect(row5.getCell(4).value).toBe(0);
    expect(row5.getCell(7).value).toBe(0);
    expect(ws.getCell(8, 1).value).toBe('No.'); // encabezado sigue presente
    expect(ws.getCell(9, 2).value ?? '').toBe(''); // sin datos
  });

  it('income_statement_excel: fiel a B4 (título 1F4E78, columnas dinámicas por día, secciones, hoja2 autoFilter, hoja3)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'income_statement_excel')!;
    expect(seed).toBeTruthy();
    const data = buildIncomeStatementData({
      subsidiaryName: 'Cd. Obregon',
      dateKeys: ['2026-07-18', '2026-07-19'],
      incomeMatrix: { 'Envío': { '2026-07-18': 100, '2026-07-19': 50 } },
      expenseMatrix: { 'Renta': { '2026-07-18': 30 } },
      detailRows: [
        { date: '2026-07-18', type: 'INGRESO', category: 'Envío', amount: 100 },
        { date: '2026-07-18', type: 'EGRESO', category: 'Renta', desc: 'Pago mensual', amount: 30, ref: 'F-001' },
      ],
    });
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);

    // --- Hoja 1: título + columnas dinámicas por día ---
    const ws1 = wb.getWorksheet('Estado de Resultados')!;
    const titleCell = ws1.getCell('A1');
    expect(titleCell.value).toBe('ESTADO DE RESULTADOS - CD. OBREGON');
    expect(titleCell.font?.color?.argb).toBe('1F4E78');
    expect(titleCell.font?.size).toBe(16);
    // El título se fusiona hasta la última columna dinámica (variable + 2 días + total = 4 -> D1)
    expect(ws1.getCell('D1').master.address).toBe('A1');

    const headerRow = ws1.getRow(3); // fila 1 título, fila 2 spacer, fila 3 encabezado de tabla
    expect(headerRow.getCell(1).value).toBe('VARIABLES');
    expect(headerRow.getCell(4).value).toBe('TOTAL ACUMULADO');
    expect((headerRow.getCell(1).fill as any).fgColor.argb).toBe('1F4E78');

    const values: { row: number; v: any }[] = [];
    ws1.eachRow({ includeEmpty: true }, (r, n) => values.push({ row: n, v: r.getCell(1).value }));
    const findRow = (v: string) => ws1.getRow(values.find((x) => x.v === v)!.row);

    // Secciones ingresos/egresos/utilidad
    expect(findRow('INGRESOS OPERATIVOS').getCell(1).font?.color?.argb).toBe('1F4E78');
    expect(findRow('EGRESOS OPERATIVOS').getCell(1).font?.color?.argb).toBe('C00000');
    const totalIncomes = findRow('TOTAL INGRESOS');
    expect(totalIncomes.getCell(2).value).toBe(100); // día 1
    expect(totalIncomes.getCell(4).value).toBe(150); // total acumulado
    const netRow = findRow('UTILIDAD NETA');
    expect(netRow.getCell(2).value).toBe(70); // 100 - 30
    expect(netRow.getCell(4).value).toBe(120); // 150 - 30
    expect((netRow.getCell(2).fill as any).fgColor.argb).toBe('27AE60'); // positivo -> verde

    // Montos con formato "$"#,##0.00
    expect(totalIncomes.getCell(2).numFmt).toBe('"$"#,##0.00');

    // --- Hoja 2: Desglose Detallado ---
    const ws2 = wb.getWorksheet('Desglose Detallado')!;
    expect(ws2.autoFilter).toBe('A1:F1');
    expect(ws2.getRow(1).getCell(1).value).toBe('FECHA');
    const detailRow2 = ws2.getRow(3); // fila 2 = ingreso, fila 3 = egreso
    expect(detailRow2.getCell(2).value).toBe('F-001');
    expect(detailRow2.getCell(3).font?.color?.argb).toBe('C00000');

    // --- Hoja 3: Dashboard ---
    const ws3 = wb.getWorksheet('Dashboard')!;
    expect(ws3.getCell('A1').value).toBe('RESUMEN EJECUTIVO DE OPERACIÓN');
    const dashHeader = ws3.getRow(3);
    expect(dashHeader.getCell(1).value).toBe('CATEGORÍA INGRESO');
    expect((dashHeader.getCell(1).fill as any).fgColor.argb).toBe('4472C4');
    const dashDataRow = ws3.getRow(4);
    expect(dashDataRow.getCell(1).value).toBe('Envío');
    expect(dashDataRow.getCell(2).value).toBe(150);
    expect(dashDataRow.getCell(3).value).toBe('Renta');
    expect(dashDataRow.getCell(4).value).toBe(30);
  });

  it('income_statement_excel: 3 días en el rango -> 3 columnas dinámicas (ancho de tabla y título consistentes)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'income_statement_excel')!;
    const data = buildIncomeStatementData({
      subsidiaryName: 'S', dateKeys: ['2026-07-18', '2026-07-19', '2026-07-20'],
      incomeMatrix: {}, expenseMatrix: {}, detailRows: [],
    });
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);
    const ws1 = wb.getWorksheet('Estado de Resultados')!;
    // variable + 3 días + total = 5 columnas -> título fusiona hasta E1
    expect(ws1.getCell('E1').master.address).toBe('A1');
    const headerRow = ws1.getRow(3);
    expect(headerRow.getCell(5).value).toBe('TOTAL ACUMULADO');
  });

  it('inventory_no67_excel: fiel a B5 (título 2E75B6, 9 cols hoja2 con header 5B9BD5 + freeze/autoFilter, distribuciones hoja3)', async () => {
    const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_no67_excel')!;
    expect(seed).toBeTruthy();
    const data = buildInventoryNo67Data({
      summary: {
        totalShipments: 4, withoutCode67: 2, withCode67: 2, percentageWithout67: 50,
        inventoryDate: '2026-07-20T12:00:00Z', inventoryId: 'INV-1',
      },
      details: [
        { trackingNumber: 'T1', currentStatus: 'en_bodega', statusHistoryCount: 2, exceptionCodes: ['03'], firstStatusDate: '2026-07-01T12:00:00Z', lastStatusDate: '2026-07-05T12:00:00Z', daysInSystem: 21, comment: 'No tiene exceptionCode 67' },
        { trackingNumber: 'T2', currentStatus: 'en_ruta', statusHistoryCount: 0, exceptionCodes: [], firstStatusDate: null, lastStatusDate: null, daysInSystem: null, comment: 'Sin historial de estados' },
      ],
      now: new Date('2026-07-22T15:00:00Z'),
    } as any);
    const buf = await new ExcelWorkbookBuilder(new TemplateEngine()).build(seed.doc, { data } as any);
    const wb = new Workbook(); await wb.xlsx.load(buf as any);

    // Hoja 1 "Resumen": título 2E75B6 + pares etiqueta/valor
    const ws1 = wb.getWorksheet('Resumen')!;
    expect(ws1.getCell('A1').value).toBe('REPORTE - SHIPMENTS SIN CÓDIGO 67');
    expect((ws1.getCell('A1').fill as any).fgColor.argb).toBe('2E75B6');
    expect(ws1.getCell('A1').font?.size).toBe(16);
    const values1: { row: number; a: any; b: any }[] = [];
    ws1.eachRow({ includeEmpty: true }, (r, n) => values1.push({ row: n, a: r.getCell(1).value, b: r.getCell(2).value }));
    expect(values1.some((x) => x.a === 'Total Shipments:' && x.b === 4)).toBe(true);
    expect(values1.some((x) => x.a === 'Sin código 67:' && x.b === 2)).toBe(true);
    expect(values1.some((x) => x.a === 'Con código 67:' && x.b === 2)).toBe(true);
    expect(values1.some((x) => x.a === 'Porcentaje sin 67:' && x.b === '50%')).toBe(true);
    expect(values1.some((x) => x.a === 'ID Inventario:' && x.b === 'INV-1')).toBe(true);
    expect(ws1.getColumn(1).width).toBe(25);
    expect(ws1.getColumn(2).width).toBe(25);

    // Hoja 2 "Detalles": 9 columnas, header 5B9BD5, freeze + autoFilter, zebra
    const ws2 = wb.getWorksheet('Detalles')!;
    const header2 = ws2.getRow(1);
    expect((header2.getCell(1).fill as any).fgColor.argb).toBe('5B9BD5');
    const labels = ['No.', 'Tracking Number', 'Estado', 'Historial', 'Códigos', 'Primera Fecha', 'Última Fecha', 'Días', 'Comentario'];
    labels.forEach((l, i) => expect(header2.getCell(i + 1).value).toBe(l));
    expect((ws2.views?.[0] as any)?.state).toBe('frozen');
    expect((ws2.views?.[0] as any)?.ySplit).toBe(1);
    expect(ws2.autoFilter).toBe('A1:I1');
    const row3 = ws2.getRow(3); // segunda fila de datos -> zebra
    expect((row3.getCell(1).fill as any).fgColor.argb).toBe('F2F2F2');
    expect(ws2.getRow(2).getCell(6).value).toBe('01/07/2026 05:00');

    // Hoja 3 "Estadísticas": título + distribuciones
    const ws3 = wb.getWorksheet('Estadísticas')!;
    expect(ws3.getCell('A1').value).toBe('ESTADÍSTICAS');
    const values3: { row: number; v: any }[] = [];
    ws3.eachRow({ includeEmpty: true }, (r, n) => values3.push({ row: n, v: r.getCell(1).value }));
    expect(values3.some((x) => x.v === 'Distribución por Estado')).toBe(true);
    expect(values3.some((x) => x.v === 'Distribución por Días')).toBe(true);
    expect(values3.some((x) => x.v === 'en_bodega')).toBe(true);
    expect(values3.some((x) => x.v === 'Sin fecha')).toBe(true);
  });
});
