import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { ExcelDoc } from '../blocks/excel-doc.types';

export interface ExcelSeedVar { name: string; label: string; dataType?: string; }
export interface ExcelSeed { code: string; name: string; doc: ExcelDoc; variables: ExcelSeedVar[]; }

/** audit_log_excel — hoja "Auditoría", 11 columnas, encabezado en negrita (inventario §B9). */
const auditLog: ExcelDoc = {
  sheets: [{
    name: 'Auditoría',
    headerFont: { bold: true },
    columns: [
      { key: 'createdAt', label: 'Fecha', width: 22 },
      { key: 'userEmail', label: 'Usuario', width: 28 },
      { key: 'userName', label: 'Nombre', width: 24 },
      { key: 'role', label: 'Rol', width: 12 },
      { key: 'module', label: 'Módulo', width: 18 },
      { key: 'subsidiaryName', label: 'Sucursal', width: 22 },
      { key: 'action', label: 'Acción', width: 14 },
      { key: 'entityId', label: 'Registro', width: 26 },
      { key: 'result', label: 'Resultado', width: 12 },
      { key: 'ip', label: 'IP', width: 16 },
      { key: 'description', label: 'Descripción', width: 50 },
    ],
    rowsVar: 'rows',
  }],
};

/** route_dispatch_excel — "Salida a Ruta" rica (fiel a C2, frontend). Hoja "Despacho" por secciones. */
const routeDispatch: ExcelDoc = {
  sheets: [{
    name: 'Despacho',
    sections: [
      { kind: 'title', text: '🚚 Salida a Ruta', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Ruta: {{routeNamesArrow}}' }, { text: 'Conductores: {{driverNames}}' },
        { text: 'Unidad: {{vehicleName}}' }, { text: 'Fecha: {{dispatchDateTime}}' }, { text: 'Paquetes: {{stats.total}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'band', rowsVar: 'invalidChunks', fill: 'FFE6E6', font: { bold: true, color: 'CC0000' }, mergeTo: 9, when: 'invalidChunks' },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientNameXlsx', label: 'Recibe', width: 30 }, { key: 'recipientAddressXlsx', label: 'Dirección', width: 40 },
          { key: 'recipientZip', label: 'CP', width: 10 }, { key: 'paymentXlsx', label: 'Cobro', width: 18 },
          { key: 'date', label: 'Fecha', width: 12 }, { key: 'time', label: 'Hora', width: 12 },
          { key: 'recipientPhone', label: 'Celular', width: 18 },
        ] },
    ],
  }],
};

/** unloading_excel — "Desembarque" rica (fiel a C4, frontend). Hoja "Desembarque" por secciones. */
const unloading: ExcelDoc = {
  sheets: [{
    name: 'Desembarque',
    sections: [
      { kind: 'title', text: '📦 Desembarque', fill: 'ef883a', font: { size: 16, bold: true, color: 'FFFFFF' }, mergeTo: 9 },
      { kind: 'spacer' },
      { kind: 'info', mergeTo: 9, rows: [
        { text: 'Unidad: {{vehicleName}}' }, { text: 'Fecha: {{createdDateTime}}' }, { text: 'Paquetes: {{totalPackages}}' },
      ] },
      { kind: 'spacer' },
      { kind: 'table', rowsVar: 'rows',
        headerFill: '8c5e4e', headerFont: { bold: true, color: 'FFFFFF' }, headerHeight: 20, headerAlign: 'center',
        bordered: true, cellAlign: 'center', wrap: true, rowFillKey: 'rowFill',
        columns: [
          { key: 'index', label: 'No.', width: 5 }, { key: 'trackingNumber', label: 'Guía', width: 18 },
          { key: 'recipientNameXlsx', label: 'Nombre', width: 45 }, { key: 'recipientAddressXlsx', label: 'Dirección', width: 45 },
          { key: 'recipientZip', label: 'C.P.', width: 12 }, { key: 'payment', label: 'Cobro', width: 20 },
          { key: 'date', label: 'Fecha', width: 12 }, { key: 'timeXlsx', label: 'Hora', width: 12 },
          { key: 'recipientPhone', label: 'Celular', width: 18 },
        ] },
      { kind: 'spacer' },
      { kind: 'title', text: '❌ Paquetes faltantes', fill: 'ef883a', font: { bold: true, color: 'FFFFFF' }, mergeTo: 9, when: 'missingTrackings' },
      { kind: 'band', rowsVar: 'missingTrackings', mergeTo: 9, when: 'missingTrackings' },
      { kind: 'spacer' },
      { kind: 'title', text: '📍 Guías sobrantes', fill: '8c5e4e', font: { bold: true, color: 'FFFFFF' }, mergeTo: 9, when: 'unScannedTrackings' },
      { kind: 'band', rowsVar: 'unScannedTrackings', mergeTo: 9, when: 'unScannedTrackings' },
    ],
  }],
};

export const EXCEL_TEMPLATE_SEEDS: ExcelSeed[] = [
  { code: 'route_dispatch_excel', name: 'Salida a Ruta (Excel)', doc: routeDispatch,
    variables: [
      { name: 'routeNamesArrow', label: 'Rutas' }, { name: 'driverNames', label: 'Conductores' },
      { name: 'vehicleName', label: 'Unidad' }, { name: 'dispatchDateTime', label: 'Fecha' },
      { name: 'stats', label: 'Métricas' }, { name: 'invalidChunks', label: 'Guías inválidas' }, { name: 'rows', label: 'Filas' },
    ] },
  { code: 'audit_log_excel', name: 'Auditoría (Excel)', doc: auditLog,
    variables: [{ name: 'rows', label: 'Filas de auditoría (createdAt ya formateado es-MX en código)' }] },
  { code: 'unloading_excel', name: 'Desembarque (Excel)', doc: unloading,
    variables: [
      { name: 'vehicleName', label: 'Unidad' }, { name: 'createdDateTime', label: 'Fecha' },
      { name: 'totalPackages', label: 'Total de paquetes', dataType: 'number' }, { name: 'rows', label: 'Filas' },
      { name: 'missingTrackings', label: 'Guías faltantes' }, { name: 'unScannedTrackings', label: 'Guías sobrantes' },
    ] },
];

interface SeedRepos { tplRepo: Repository<DocumentTemplate>; verRepo: Repository<DocumentTemplateVersion>; varRepo: Repository<TemplateVariableDef>; }

export async function seedExcelTemplates(repos: SeedRepos): Promise<void> {
  for (const seed of EXCEL_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) template = await repos.tplRepo.save(repos.tplRepo.create({ code: seed.code, name: seed.name, type: 'excel', language: 'es', active: true, category: 'reporte' }));
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) version = await repos.verRepo.save(repos.verRepo.create({ templateId: template.id, version: 1, status: 'published', subject: null, designJson: seed.doc, compiledBody: null, engine: 'handlebars', changelog: 'Seed inicial Excel (fiel a exceljs legacy)', publishedAt: new Date() }));
    if (!template.currentVersionId) { template.currentVersionId = version.id; await repos.tplRepo.save(template); }
    const existing = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existing.length === 0) await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({ templateId: template.id, name: v.name, label: v.label, dataType: (v.dataType as any) ?? 'string', example: null, required: false })));
  }
}
