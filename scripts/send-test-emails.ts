/**
 * Prueba end-to-end del Motor de Plantillas: renderiza correos y documentos por el
 * motor y los envía SOLO a un destinatario de prueba. NO usa las listas de la empresa.
 * Uso: ts-node --transpile-only -r tsconfig-paths/register scripts/send-test-emails.ts
 * La contraseña SMTP se lee de .env (EMAIL_SERVICE_PASSWORD); nunca se imprime.
 */
import 'dotenv/config';
import * as nodemailer from 'nodemailer';

import { EMAIL_TEMPLATE_SEEDS } from '../src/documents/seeds/email-templates.seed';
import { blocksToUnlayerDesign } from '../src/documents/seeds/blocks-to-unlayer';
import { EmailRenderer } from '../src/documents/renderers/email.renderer';
import { TemplateEngine } from '../src/documents/template-engine';
import { BlockComposer } from '../src/documents/blocks/block-composer';
import { DEFAULT_BRAND_TOKENS } from '../src/documents/documents.types';

import { ExcelWorkbookBuilder } from '../src/documents/blocks/excel-workbook-builder';
import { PdfHtmlComposer } from '../src/documents/blocks/pdf-html-composer';
import { HtmlToPdfService } from '../src/documents/html-to-pdf.service';
import { EXCEL_TEMPLATE_SEEDS } from '../src/documents/seeds/excel-templates.seed';
import { PDF_TEMPLATE_SEEDS } from '../src/documents/seeds/pdf-templates.seed';
import { buildRouteDispatchData } from '../src/documents/data/route-dispatch.mapper';
import { buildInventoryData } from '../src/documents/data/inventory.mapper';
import { buildUnloadingData } from '../src/documents/data/unloading.mapper';
import { buildRouteClosureData } from '../src/documents/data/route-closure.mapper';
import { buildReturningData } from '../src/documents/data/returning.mapper';

const TEST_TO = process.env.TEST_EMAIL_TO || 'javier.rappaz@gmail.com';

const engine = new TemplateEngine();
const emailRenderer = new EmailRenderer(engine, new BlockComposer());
const excelBuilder = new ExcelWorkbookBuilder(engine);
const pdfComposer = new PdfHtmlComposer();

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://app-pmy.vercel.app/', env: 'prueba' } };
}

/** Datos de muestra que cubren cualquier variable declarada por un seed de correo. */
function sampleFor(seed: any): Record<string, any> {
  const d: Record<string, any> = {};
  for (const v of seed.variables ?? []) {
    const n = v.name;
    if (n === 'rows') {
      d.rows = [
        { trackingNumber: '794112233445', recipientName: 'Ana López', recipientAddress: 'Calle 5 de Febrero 123, Centro', recipientZip: '85000', timestamp: '2026-07-22 09:15', doItByUser: 'jose.martinez', recipientPhone: '6441234567', status: 'DEX03', dexCode: '03', route: 'Ruta 1', consNumber: 'C-1001' },
        { trackingNumber: '794556677889', recipientName: 'Beto Ramírez', recipientAddress: 'Blvd. Rodríguez 456', recipientZip: '85040', timestamp: '2026-07-22 10:02', doItByUser: 'jose.martinez', recipientPhone: '6449876543', status: 'DEX03', dexCode: '03', route: 'Ruta 2', consNumber: 'C-1002' },
      ];
    } else if (n === 'tableHtml') {
      d.tableHtml = '<table border="1" cellpadding="6" style="border-collapse:collapse"><tr style="background:#8c5e4e;color:#fff"><th>Tracking</th><th>Estado</th></tr><tr><td>794112233445</td><td>Prioridad Alta</td></tr></table>';
    } else if (v.dataType === 'date' || n === 'today' || n === 'createdAt') {
      d[n] = new Date();
    } else if (n === 'code') {
      d[n] = '482913';
    } else if (n === 'minutes') {
      d[n] = 15;
    } else if (/link|url/i.test(n)) {
      d[n] = 'https://app-pmy.vercel.app/reportes';
    } else if (n === 'subsidiaryName') {
      d[n] = 'Cd. Obregón';
    } else {
      d[n] = `PRUEBA ${n}`;
    }
  }
  return d;
}

async function renderEmail(code: string) {
  const seed = EMAIL_TEMPLATE_SEEDS.find((s) => s.code === code);
  if (!seed) throw new Error(`seed de correo '${code}' no encontrado`);
  const version: any = {
    subject: seed.subject,
    designJson: blocksToUnlayerDesign(seed.blocks),
    compiledBody: new BlockComposer().compose({ blocks: seed.blocks }),
  };
  return emailRenderer.render(version, ctx(sampleFor(seed)) as any);
}

async function renderExcel(code: string, data: any): Promise<Buffer> {
  const seed = EXCEL_TEMPLATE_SEEDS.find((s) => s.code === code)!;
  return excelBuilder.build(seed.doc, ctx(data) as any);
}

async function renderPdf(code: string, data: any): Promise<Buffer | null> {
  try {
    const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === code)!;
    const template = pdfComposer.compose(seed.doc);
    const html = engine.render(template, ctx(data) as any);
    const buf = await new HtmlToPdfService().convert(html);
    return buf && buf.length ? buf : null;
  } catch (e: any) {
    console.warn(`  PDF '${code}' no generado (¿sin Chromium?): ${e?.message}`);
    return null;
  }
}

async function main() {
  const host = process.env.EMAIL_SERVICE_HOST;
  const user = process.env.EMAIL_SERVICE_EMAIL;
  if (!host || !user || !process.env.EMAIL_SERVICE_PASSWORD) {
    throw new Error('Faltan variables EMAIL_SERVICE_* en .env');
  }
  const transport = nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_SERVICE_PORT ?? '465', 10),
    secure: (process.env.EMAIL_SERVICE_SECURE ?? 'true') === 'true',
    auth: { user, pass: process.env.EMAIL_SERVICE_PASSWORD },
  });
  const from = `"PMY App [PRUEBA]" <${user}>`;

  const send = async (subject: string, html: string, attachments?: any[]) => {
    const info = await transport.sendMail({ from, to: TEST_TO, subject: `[PRUEBA] ${subject}`, html, attachments });
    console.log(`  ✅ enviado: "${subject}"  id=${info.messageId}`);
  };

  console.log(`Enviando correos de PRUEBA SOLO a ${TEST_TO} (sin listas de la empresa)...`);

  // 1) DEX03 (la regresión) — debe traer su tabla real, NO el genérico
  const dex = await renderEmail('dex03_report');
  console.log(`  dex03: fallback=${dex.html?.includes('no disponible') ? 'SÍ ❌' : 'NO ✅'}`);
  await send(dex.subject ?? 'dex03', dex.html ?? '');

  // 2) Inventario prioridad (correo con tabla HTML)
  const prio = await renderEmail('inventory_priority_packages');
  await send(prio.subject ?? 'inventario prioridad', prio.html ?? '');

  // 3) Cierre de ruta (correo)
  const cierre = await renderEmail('route_closure');
  await send(cierre.subject ?? 'cierre', cierre.html ?? '');

  // 4) Correo con DOCUMENTOS adjuntos generados por el Motor (Excel siempre; PDF si hay Chromium)
  const rdData = buildRouteDispatchData({
    subsidiaryName: 'Cd. Obregón', vehicleName: 'ECON-01', drivers: [{ name: 'José Martínez' }], routes: [{ name: 'Ruta 1' }, { name: 'Ruta 2' }],
    trackingNumber: 'SEG-PRUEBA-1', now: new Date(),
    packages: [
      { trackingNumber: '794112233445', recipientName: 'Ana López', recipientAddress: 'Calle 5 de Febrero 123', recipientZip: '85000', recipientPhone: '6441234567', payment: { amount: 500, type: 'COD' }, commitDateTime: new Date().toISOString(), isCharge: true },
      { trackingNumber: '794556677889', recipientName: 'Beto Ramírez', recipientAddress: 'Blvd. Rodríguez 456', recipientZip: '83000', shipmentType: 'dhl' },
    ],
    invalidTrackings: ['999000111'],
  } as any);
  const invData = buildInventoryData({
    subsidiaryName: 'Cd. Obregón', trackingNumber: 'INV-PRUEBA-1', inventoryDate: new Date().toISOString(), now: new Date(),
    packages: [{ trackingNumber: '794112233445', recipientName: 'Ana López', recipientAddress: 'Calle 5', recipientZip: '85000', isCharge: true, payment: { amount: 500, type: 'COD' }, commitDateTime: new Date().toISOString() }],
    missingTrackings: ['X-999'], unScannedTrackings: [],
  } as any);

  const unlData = buildUnloadingData({
    subsidiaryName: 'Cd. Obregón', vehicleName: 'ECON-01', trackingNumber: 'DESEMB-PRUEBA-1', now: new Date(), createdAt: new Date().toISOString(),
    packages: [
      { trackingNumber: '794112233445', recipientName: 'Ana López', recipientAddress: 'Calle 5 de Febrero 123, Centro', recipientZip: '85000', recipientPhone: '6441234567', payment: { amount: 500, type: 'COD' }, commitDateTime: new Date().toISOString(), isCharge: true },
      { trackingNumber: '794556677889', recipientName: 'Beto Ramírez', recipientAddress: 'Blvd. Rodríguez 456', recipientZip: '85040', commitDateTime: new Date().toISOString() },
    ],
    missingPackages: ['999000111'], unScannedTrackings: ['888777666'],
  } as any);

  const closeData = buildRouteClosureData({
    subsidiaryName: 'Cd. Obregón', vehicleName: 'ECON-01', drivers: [{ name: 'José Martínez' }], routes: [{ name: 'Ruta 1' }, { name: 'Ruta 2' }],
    trackingNumber: 'SEG-PRUEBA-1', kmsInitial: '12000', kmsFinal: '12180', dispatchCreatedAt: new Date().toISOString(),
    allPackages: [
      { trackingNumber: '794112233445', recipientName: 'Ana López', recipientAddress: 'Calle 5', recipientPhone: '6441234567', shipmentType: 'fedex', payment: { amount: 500, type: 'COD' } },
      { trackingNumber: '794556677889', recipientName: 'Beto Ramírez', recipientAddress: 'Blvd. Rodríguez 456', recipientPhone: '6449876543', shipmentType: 'dhl' },
      { trackingNumber: '794999888777', recipientName: 'Carla Ruiz', recipientAddress: 'Calle Sonora 12', recipientPhone: '6441112222', shipmentType: 'fedex' },
    ],
    returnedPackages: [{ trackingNumber: '794556677889', recipientName: 'Beto Ramírez', recipientAddress: 'Blvd. Rodríguez 456', recipientPhone: '6449876543', status: 'CLIENTE_NO_DISPONIBLE', dexCode: '08' } as any],
    podPackages: [{ trackingNumber: '794112233445', recipientName: 'Ana López' } as any],
    noVanPackages: [{ trackingNumber: '794999888777', status: 'EN_BODEGA' } as any],
    collections: ['REC-1001', 'REC-1002'],
    now: new Date(),
  } as any);

  const retData = buildReturningData({
    subsidiaryName: 'Cd. Obregón',
    devolutions: [
      { trackingNumber: '794556677889', status: 'CLIENTE_NO_DISPONIBLE', dexCode: '08' } as any,
      { trackingNumber: '794222333444', status: 'RECHAZO', dexCode: '07' } as any,
    ],
    collections: [{ trackingNumber: 'REC-1001', subsidiaryName: 'Cd. Obregón' } as any, { trackingNumber: 'REC-1002', subsidiaryName: 'Navojoa' } as any],
    now: new Date(),
  } as any);

  const attachments: any[] = [
    { filename: 'Salida-a-Ruta--PRUEBA.xlsx', content: await renderExcel('route_dispatch_excel', rdData) },
    { filename: 'Inventario--PRUEBA.xlsx', content: await renderExcel('inventory_excel', invData) },
  ];

  // Los 5 PDF ricos, cada uno best-effort (si un mapper/datos no cuadra, se omite y se anota).
  const pdfPlan: Array<[string, string, any]> = [
    ['route_dispatch_pdf', 'Salida-a-Ruta--PRUEBA.pdf', rdData],
    ['unloading_pdf', 'Desembarque--PRUEBA.pdf', unlData],
    ['inventory_pdf', 'Inventario--PRUEBA.pdf', invData],
    ['route_closure_pdf', 'Cierre-de-Ruta--PRUEBA.pdf', closeData],
    ['returning_pdf', 'Devoluciones--PRUEBA.pdf', retData],
  ];
  const okPdfs: string[] = [];
  const okHtml: string[] = [];
  for (const [code, filename, data] of pdfPlan) {
    // HTML compuesto+interpolado (NO requiere Chromium): abre en navegador = mismo layout del PDF.
    try {
      const seed = PDF_TEMPLATE_SEEDS.find((s) => s.code === code)!;
      const html = engine.render(pdfComposer.compose(seed.doc), ctx(data) as any);
      attachments.push({ filename: filename.replace('.pdf', '.html'), content: Buffer.from(html, 'utf8'), contentType: 'text/html' });
      okHtml.push(filename.replace('--PRUEBA.pdf', ''));
    } catch (e: any) {
      console.warn(`  HTML '${code}' no generado: ${e?.message}`);
    }
    // PDF real (si el entorno tiene Chromium; aquí suele fallar con spawn UNKNOWN).
    const buf = await renderPdf(code, data);
    if (buf) { attachments.push({ filename, content: buf }); okPdfs.push(filename.replace('--PRUEBA.pdf', '')); }
  }

  const bodyDocs = `<div style="font-family:Arial"><h2 style="color:#8c5e4e">Documentos de prueba (Motor de Plantillas)</h2>
    <p>Adjuntos generados por el Motor de Plantillas para validación visual.</p>
    <p><b>Layouts de PDF como HTML (${okHtml.length}/5)</b> — ábrelos en tu navegador para ver el diseño exacto del PDF: ${okHtml.join(', ') || 'ninguno'}.</p>
    <p><b>PDF reales (${okPdfs.length}/5):</b> ${okPdfs.join(', ') || 'ninguno — este entorno no pudo lanzar Chromium; en tu servidor sí saldrán'}.</p>
    <p><b>Excel:</b> Salida a Ruta, Inventario.</p></div>`;
  await send(`Documentos adjuntos (${attachments.length}: HTML de PDF + Excel${okPdfs.length ? ' + PDF' : ''})`, bodyDocs, attachments);

  console.log('Listo.');
  await transport.close?.();
}

main().catch((e) => { console.error('ERROR:', e?.message ?? e); process.exit(1); });
