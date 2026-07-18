import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { PdfDoc } from '../blocks/pdf-doc.types';
import { ROUTE_DISPATCH_PDF_HTML } from './templates/route-dispatch.pdf.html';
import { UNLOADING_PDF_HTML } from './templates/unloading.pdf.html';

export interface PdfSeedVar { name: string; label: string; dataType?: string; }
export interface PdfSeed { code: string; name: string; doc: PdfDoc; variables: PdfSeedVar[]; }

/** warehouse_dispatch_pdf — fiel al PDF pdfmake actual (inventario §B1). Datos/flags en código. */
const warehouseDispatch: PdfDoc = {
  page: { size: 'LETTER', orientation: 'landscape', margins: '20px' },
  header: { title: '{{title}}', showDateTime: true },
  blocks: [
    { type: 'infoGrid', cells: [
      { label: 'SUCURSAL', value: '{{subsidiaryName}}' },
      { label: 'VEHÍCULO', value: '{{vehicleName}}' },
      { label: 'TOTAL PAQUETES', value: '{{totalPackages}}' },
      { label: 'SEGUIMIENTO', value: '{{trackingNumber}}' },
    ] },
    { type: 'symbology', text: 'SIMBOLOGÍA: [C] CARGA/F2/31.5 - [$] PAGO - [H] VALOR ALTO - [A] AÉREO' },
    { type: 'table', rowsVar: 'rows', rowClassVar: 'rowClass', columns: [
      { label: '[#]', key: 'index', width: 20 },
      { label: 'NO. GUIA', key: 'trackingNumber', width: 65 },
      { label: 'NOMBRE', key: 'recipientName', width: 100 },
      { label: 'DIRECCIÓN', key: 'recipientAddress', width: 140 },
      { label: 'CP', key: 'recipientZip', width: 30 },
      { label: 'COBRO', key: 'payment', width: 50 },
      { label: 'FECHA', key: 'date', width: 50 },
      { label: 'HORA', key: 'time', width: 40, hideWhen: 'isHermosillo' },
      { label: 'CELULAR', key: 'recipientPhone', width: 60 },
      { label: 'FIRMA', key: 'signature', width: 80 },
    ] },
  ],
};

/** route_dispatch_pdf — "Salida a Ruta" rica (fiel a C1, frontend). Presentación HTML; datos en el data-provider. */
const routeDispatch: PdfDoc = {
  page: { size: 'LETTER', orientation: 'landscape', margins: '5px' },
  html: ROUTE_DISPATCH_PDF_HTML,
};

/** unloading_pdf — "Desembarque" rica (fiel a C3, frontend). Presentación HTML; datos en el data-provider. */
const unloading: PdfDoc = {
  page: { size: 'LETTER', orientation: 'landscape', margins: '20px' },
  html: UNLOADING_PDF_HTML,
};

export const PDF_TEMPLATE_SEEDS: PdfSeed[] = [
  { code: 'route_dispatch_pdf', name: 'Salida a Ruta (PDF)', doc: routeDispatch,
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal' }, { name: 'vehicleName', label: 'Vehículo' },
      { name: 'mainDriver', label: 'Chofer principal' }, { name: 'routeNames', label: 'Rutas' },
      { name: 'trackingNumber', label: 'Seguimiento' }, { name: 'isHermosillo', label: 'Es Hermosillo', dataType: 'boolean' },
      { name: 'generatedDate', label: 'Fecha generación' }, { name: 'generatedTime', label: 'Hora generación' },
      { name: 'stats', label: 'Métricas' }, { name: 'rows', label: 'Filas de paquetes' },
      { name: 'invalidRows', label: 'Trackings inválidos' }, { name: 'hasInvalid', label: 'Hay inválidos', dataType: 'boolean' },
    ] },
  { code: 'warehouse_dispatch_pdf', name: 'Salida a Ruta / Bodega (PDF)', doc: warehouseDispatch,
    variables: [
      { name: 'title', label: 'Título' },
      { name: 'subsidiaryName', label: 'Sucursal' },
      { name: 'vehicleName', label: 'Vehículo' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'isHermosillo', label: 'Es Hermosillo (oculta HORA)', dataType: 'boolean' },
      { name: 'rows', label: 'Filas de paquetes' },
    ] },
  { code: 'unloading_pdf', name: 'Desembarque (PDF)', doc: unloading,
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal' }, { name: 'vehicleName', label: 'Unidad' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'nowDateTime', label: 'Fecha de generación' },
      { name: 'rows', label: 'Filas de paquetes' },
      { name: 'missingRows', label: 'Guías faltantes' }, { name: 'hasMissing', label: 'Hay faltantes', dataType: 'boolean' },
      { name: 'unScannedTrackings', label: 'Guías sobrantes' }, { name: 'hasUnScanned', label: 'Hay sobrantes', dataType: 'boolean' },
    ] },
];

interface SeedRepos {
  tplRepo: Repository<DocumentTemplate>;
  verRepo: Repository<DocumentTemplateVersion>;
  varRepo: Repository<TemplateVariableDef>;
}

/** Upsert idempotente por code. */
export async function seedPdfTemplates(repos: SeedRepos): Promise<void> {
  for (const seed of PDF_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) {
      template = await repos.tplRepo.save(repos.tplRepo.create({
        code: seed.code, name: seed.name, type: 'pdf', language: 'es', active: true, category: 'reporte',
      }));
    }
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) {
      version = await repos.verRepo.save(repos.verRepo.create({
        templateId: template.id, version: 1, status: 'published',
        subject: null, designJson: seed.doc, compiledBody: null, engine: 'handlebars',
        changelog: 'Seed inicial PDF (fiel a pdfmake legacy)', publishedAt: new Date(),
      }));
    }
    if (!template.currentVersionId) { template.currentVersionId = version.id; await repos.tplRepo.save(template); }
    const existing = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existing.length === 0) {
      await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({
        templateId: template.id, name: v.name, label: v.label, dataType: (v.dataType as any) ?? 'string', example: null, required: false,
      })));
    }
  }
}
