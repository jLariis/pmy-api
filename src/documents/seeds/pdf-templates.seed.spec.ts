import { seedPdfTemplates, PDF_TEMPLATE_SEEDS } from './pdf-templates.seed';
import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { TemplateEngine } from '../template-engine';
import { buildRouteDispatchData } from '../data/route-dispatch.mapper';
import { buildUnloadingData } from '../data/unloading.mapper';
import { buildInventoryData } from '../data/inventory.mapper';
import { buildRouteClosureData } from '../data/route-closure.mapper';
import { buildReturningData } from '../data/returning.mapper';

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
    const table = (seed.doc.blocks ?? []).find((b: any) => b.type === 'table') as any;
    const hora = table.columns.find((c: any) => c.label === 'HORA');
    expect(hora.hideWhen).toBe('isHermosillo');
  });

  it('route_dispatch_pdf: HTML fiel (métricas, simbología, HORA visible fuera de Hermosillo, inválidos)', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch_pdf')!;
    expect(seed).toBeTruthy();
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildRouteDispatchData({
      subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', drivers: [{ name: 'Juan' }], routes: [{ name: 'R1' }],
      trackingNumber: 'SEG-1', now: new Date('2026-07-18T20:00:00Z'),
      packages: [{ trackingNumber: 'T1', recipientName: 'Ana', recipientZip: '85000', payment: { amount: 500, type: 'COD' } }],
      invalidTrackings: ['X1'],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('SALIDA A RUTA');
    expect(out).toContain('SIMBOLOGÍA: [C] CARGA/F2/31.5');
    expect(out).toContain('VENCEN HOY');
    expect(out).toContain('COD $500');
    expect(out).toContain('TRACKINGS INVÁLIDOS');
    expect(out).toContain('<th style="width:38px">HORA</th>'); // no Hermosillo → HORA visible
  });

  it('route_dispatch_pdf: oculta HORA en Hermosillo', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_dispatch_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildRouteDispatchData({ subsidiaryName: 'Hermosillo', drivers: [], routes: [], trackingNumber: 'S', packages: [] } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).not.toContain('>HORA<');
  });

  it('unloading_pdf: HTML fiel a C3 (título, simbología, seguimiento, columnas, cobro, faltantes/sobrantes)', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'unloading_pdf')!;
    expect(seed).toBeTruthy();
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildUnloadingData({
      subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01', trackingNumber: 'DESEMB-1',
      now: new Date('2026-07-18T20:00:00Z'), createdAt: '2026-07-18T18:30:00Z',
      packages: [{ trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
        payment: { amount: 500, type: 'COD' }, commitDateTime: '2026-07-18T20:15:00Z' }],
      missingPackages: ['X1'],
      unScannedTrackings: ['Y1'],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('Desembarque');
    expect(out).toContain('Simbología: [C] Carga/F2/31.5 [$] Pago [H] Valor alto');
    expect(out).toContain('Número de seguimiento');
    expect(out).toContain('No. Guía');
    expect(out).toContain('COD $500.00');
    expect(out).toContain('* Guías faltantes');
    expect(out).toContain('X1');
    expect(out).toContain('** Guías sobrantes');
    expect(out).toContain('Y1');
  });

  it('unloading_pdf: sin faltantes/sobrantes, no muestra esas secciones', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'unloading_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildUnloadingData({ subsidiaryName: 'S', trackingNumber: 'T', packages: [] } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).not.toContain('* Guías faltantes');
    expect(out).not.toContain('** Guías sobrantes');
  });

  it('inventory_pdf: LETTER portrait', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_pdf')!;
    expect(seed).toBeTruthy();
    expect(seed.doc.page.size).toBe('LETTER');
    expect(seed.doc.page.orientation).toBe('portrait');
  });

  it('inventory_pdf: HTML fiel a C5 (título, grid, badges, cobro crudo, stats, faltantes/sin-escaneo, firmas)', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildInventoryData({
      subsidiaryName: 'Cd. Obregon', trackingNumber: 'INV-1',
      inventoryDate: '2026-07-18T18:30:00Z', now: new Date('2026-07-18T20:00:00Z'),
      packages: [
        { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
          isCharge: true, payment: { amount: 500, type: 'COD' }, commitDateTime: '2026-07-18T20:15:00Z' },
        { trackingNumber: 'T2', recipientName: 'Beto', isHighValue: true },
      ],
      missingTrackings: ['X1'],
      unScannedTrackings: ['Y1'],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('INVENTARIO DE PAQUETES');
    expect(out).toContain('SUCURSAL');
    expect(out).toContain('FECHA INVENTARIO');
    expect(out).toContain('VÁLIDOS');
    expect(out).toContain('ALTO VALOR');
    expect(out).toContain('badge-c');
    expect(out).toContain('badge-p');
    expect(out).toContain('COD $500'); // crudo, sin Intl
    expect(out).toContain('GUIAS FALTANTES');
    expect(out).toContain('X1');
    expect(out).toContain('GUIAS SIN ESCANEO');
    expect(out).toContain('Y1');
    expect(out).toContain('RESPONSABLE DE INVENTARIO');
    expect(out).toContain('SUPERVISOR');
    expect(out).not.toContain('CELULAR'); // fiel a C5: la tabla de inventario NO tiene columna Celular
  });

  it('inventory_pdf: sin faltantes/sin-escaneo, no muestra esas secciones', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildInventoryData({ subsidiaryName: 'S', packages: [] } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).not.toContain('GUIAS FALTANTES');
    expect(out).not.toContain('GUIAS SIN ESCANEO');
  });

  it('inventory_pdf: con más de 15 faltantes, muestra "...y N más"', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'inventory_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const many = Array.from({ length: 18 }, (_, i) => `M${i + 1}`);
    const data = buildInventoryData({ subsidiaryName: 'S', packages: [], missingTrackings: many } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('...y 3 más');
    expect(out).not.toContain('M16');
  });

  it('route_closure_pdf: LETTER portrait', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_closure_pdf')!;
    expect(seed).toBeTruthy();
    expect(seed.doc.page.size).toBe('LETTER');
    expect(seed.doc.page.orientation).toBe('portrait');
  });

  it('route_closure_pdf: HTML fiel a C7 (título, grid, 2 columnas, devueltos, NO VAN, DEX, desglose, recolecciones, cobros, stats, firmas)', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_closure_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    expect(html).toContain('class="rc-left"');
    expect(html).toContain('class="rc-right"');
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
      noVanPackages: [{ trackingNumber: 'X1', status: 'Entregado' }],
      collections: ['REC-1'],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('CIERRE DE RUTA');
    expect(out).toContain('DEVUELTOS (1)');
    expect(out).toContain('DEX03');
    expect(out).toContain('PAQUETES NO VAN (1)');
    expect(out).toContain('DEX - EXCEPCIONES');
    expect(out).toContain('DESGLOSE POR PAQUETERÍA');
    expect(out).toContain('RECOLECCIONES (1)');
    expect(out).toContain('REC-1');
    expect(out).toContain('COBROS (1)');
    expect(out).toContain('$500');
    expect(out).toContain('% DEVOLUCIÓN');
    expect(out).toContain('FIRMA DE CONFORMIDAD');
    expect(out).toContain('FIRMA DE CONFIRMACIÓN');
  });

  it('route_closure_pdf: sin devueltos/No VAN/recolecciones/cobros, muestra los placeholders "No hay..."', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'route_closure_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildRouteClosureData({
      subsidiaryName: 'S', drivers: [], routes: [], trackingNumber: 'T',
      allPackages: [], returnedPackages: [], podPackages: [],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('No hay devueltos');
    expect(out).toContain('No hay paquetes No VAN');
    expect(out).toContain('No hay recolecciones');
    expect(out).toContain('No hay cobros');
  });

  it('returning_pdf: A4 portrait', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'returning_pdf')!;
    expect(seed).toBeTruthy();
    expect(seed.doc.page.size).toBe('A4');
    expect(seed.doc.page.orientation).toBe('portrait');
  });

  it('returning_pdf: HTML fiel a C9 (branding FedEx, localidad, resumen, 2 columnas, DEX, leyenda)', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'returning_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildReturningData({
      subsidiaryName: 'Cd. Obregon',
      now: new Date('2026-07-22T18:00:00Z'),
      devolutions: [{ trackingNumber: 'D1', reason: '03' }],
      collections: [{ trackingNumber: 'C1' }, { trackingNumber: 'C2' }],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    expect(out).toContain('Fed');
    expect(out).toContain('Ex');
    expect(out).toContain('CD. OBREGON');
    expect(out).toContain('DEVOLUCIONES Y RECOLECCIONES');
    expect(out).toContain('TOTAL RECOLECCIONES');
    expect(out).toContain('TOTAL DEVOLUCIONES');
    expect(out).toContain('TOTAL GENERAL');
    expect(out).toContain('DEVOLUCION (Envío no entregado)');
    expect(out).toContain('RECOLECCIONES');
    expect(out).toContain('D1');
    expect(out).toContain('DEX03');
    expect(out).toContain('rt-dex');
    expect(out).toContain('C1');
    expect(out).toContain('CD.'); // sucursal 3 letras
    expect(out).toContain('DEX 03: DATOS INCORRECTOS');
    expect(out).toContain('DEX 17: CAMBIO DE FECHA SOLICITADO');
    expect(out).toContain('Nombre y Firma');
  });

  it('returning_pdf: rellena filas hasta 15 cuando hay al menos un dato', () => {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === 'returning_pdf')!;
    const html = new PdfHtmlComposer().compose(seed.doc);
    const data = buildReturningData({
      subsidiaryName: 'S', devolutions: [{ trackingNumber: 'D1', reason: '03' }], collections: [],
    } as any);
    const out = new TemplateEngine().render(html, { data, brand: { logoLight: null, colors: {}, typography: {} }, system: { now: new Date() } } as any);
    const rows = (out.match(/<tr class="[^"]*">/g) || []).length;
    // 15 filas de devoluciones + 0 de recolecciones (sin datos, sin relleno)
    expect(rows).toBe(15);
  });
});
