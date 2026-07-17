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

export const EXCEL_TEMPLATE_SEEDS: ExcelSeed[] = [
  { code: 'audit_log_excel', name: 'Auditoría (Excel)', doc: auditLog,
    variables: [{ name: 'rows', label: 'Filas de auditoría (createdAt ya formateado es-MX en código)' }] },
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
