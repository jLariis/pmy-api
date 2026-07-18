import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { EmailBlock } from '../blocks/email-doc.types';
import { BlockComposer } from '../blocks/block-composer';
import { blocksToUnlayerDesign } from './blocks-to-unlayer';

export interface EmailSeedVar { name: string; label: string; dataType?: string; example?: string; required?: boolean; }
export interface EmailSeed { code: string; name: string; subject: string; blocks: EmailBlock[]; variables: EmailSeedVar[]; }

/** Inventario de correos (spec §9). Paridad: cada variable actual está declarada. */
export const EMAIL_TEMPLATE_SEEDS: EmailSeed[] = [
  { code: 'route_dispatch', name: 'Salida a Ruta',
    subject: '🚚 Salida a Ruta - {{driverName}} - {{subsidiaryName}} - {{formatDate createdAt}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Salida a Ruta' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Salida a Ruta</b> para la sucursal <b>{{subsidiaryName}}</b> en la unidad <b>{{vehicleName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha y hora', value: '{{formatDate createdAt}}' },
        { label: 'Responsable(s)', value: '{{drivers}}' },
        { label: 'Ruta(s)', value: '{{routes}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
      { id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'drivers', label: 'Responsables' },
      { name: 'routes', label: 'Rutas' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'driverName', label: 'Chofer principal' },
      { name: 'detailLink', label: 'Enlace al sistema' },
    ] },

  { code: 'unloading', name: 'Desembarque',
    subject: '🚚 Desembarque - {{subsidiaryName}} - {{formatDate createdAt}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Desembarque' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Desembarque</b> para la sucursal <b>{{subsidiaryName}}</b> descargado de la unidad <b>{{vehicleName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha y hora', value: '{{formatDate createdAt}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
      { id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'detailLink', label: 'Enlace al sistema' },
    ] },

  { code: 'route_closure', name: 'Cierre de Ruta',
    subject: '🚚 Cierre de Ruta - {{driverName}} - {{subsidiaryName}} - {{formatDate createdAt}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Cierre de Ruta' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Cierre de Ruta</b> para la sucursal <b>{{subsidiaryName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha y hora', value: '{{formatDate createdAt}}' },
        { label: 'Chofer', value: '{{driverName}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
      { id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'driverName', label: 'Chofer' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'detailLink', label: 'Enlace al sistema' },
    ] },

  { code: 'inventory_report', name: 'Inventario',
    subject: '📦 Inventario - {{subsidiaryName}} - {{formatDate inventoryDate}}',
    blocks: [
      { id: 'h', type: 'heading', text: '📦 Reporte de Inventario' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Inventario</b> para la sucursal <b>{{subsidiaryName}}</b>.' },
      { id: 'kv', type: 'keyValue', items: [
        { label: 'Fecha', value: '{{formatDate inventoryDate}}' },
        { label: 'Seguimiento', value: '{{trackingNumber}}' },
      ] },
      { id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'inventoryDate', label: 'Fecha de inventario', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'detailLink', label: 'Enlace al sistema' },
    ] },

  { code: 'devolutions', name: 'Devoluciones/Recolecciones',
    subject: '🔄 Devoluciones/Recolecciones - {{subsidiaryName}} - {{formatDate createdAt}}',
    blocks: [
      { id: 'h', type: 'heading', text: '🚚 Reporte de Devoluciones/Recolecciones' },
      { id: 'p', type: 'paragraph', text: 'Se generó un reporte de <b>Devoluciones/Recolecciones</b> para la sucursal <b>{{subsidiaryName}}</b>.' },
      { id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'detailLink', label: 'Enlace al sistema' },
    ] },

  { code: 'dex03_report', name: 'Paquetes con status DEX03',
    subject: '🚨🚥 Paquetes con status DEX03 de {{subsidiaryName}}',
    blocks: [
      { id: 'h', type: 'heading', text: 'Reporte de Paquetes con DEX03 — {{subsidiaryName}}' },
      { id: 'p', type: 'paragraph', text: 'Se detectaron los siguientes envíos con status DEX03. Considere la fecha de recepción ({{formatDate today}}) para su seguimiento.' },
      { id: 't', type: 'table', rowsVar: 'rows', columns: [
        { label: 'Tracking', key: 'trackingNumber' },
        { label: 'Nombre', key: 'recipientName' },
        { label: 'Dirección', key: 'recipientAddress' },
        { label: 'CP', key: 'recipientZip' },
        { label: 'Fecha', key: 'timestamp' },
        { label: 'Por', key: 'doItByUser' },
        { label: 'Teléfono', key: 'recipientPhone' },
      ] },
      { id: 'link', type: 'button', text: 'Ver en el sistema', url: '{{detailLink}}', when: 'detailLink' },
    ],
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'today', label: 'Fecha del reporte', dataType: 'date' },
      { name: 'rows', label: 'Filas (envíos DEX03)' },
      { name: 'detailLink', label: 'Enlace al sistema' },
    ] },

  { code: 'high_priority_shipments', name: 'Envíos Prioridad Alta en Curso',
    subject: '🔴 Envíos con Prioridad Alta en Curso',
    blocks: [
      { id: 'h', type: 'heading', text: 'Envíos con Prioridad Alta en Curso' },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ],
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }] },

  { code: 'unloading_priority_packages', name: 'Envíos Prioridad Alta en Descarga',
    subject: '🔴 Envíos con Prioridad Alta en Descarga',
    blocks: [
      { id: 'h', type: 'heading', text: 'Envíos con Prioridad Alta en Descarga' },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ],
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }] },

  { code: 'inventory_priority_packages', name: 'Envíos Prioridad Alta en Inventario',
    subject: '🔴 Envíos con Prioridad Alta en Inventario',
    blocks: [
      { id: 'h', type: 'heading', text: 'Envíos con Prioridad Alta en Inventario' },
      { id: 'r', type: 'raw', html: '{{{tableHtml}}}' },
    ],
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }] },

  { code: 'password_reset_otp', name: 'Código de recuperación (OTP)',
    subject: 'Tu código de recuperación: {{code}}',
    blocks: [
      { id: 'h', type: 'heading', text: 'Recuperación de contraseña — PMY App' },
      { id: 'p', type: 'paragraph', text: 'Usa este código para restablecer tu contraseña. Vence en {{minutes}} minutos.' },
      { id: 'code', type: 'paragraph', text: '<div style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center">{{code}}</div>' },
      { id: 'note', type: 'paragraph', text: 'Si no solicitaste este código, ignora este correo.' },
    ],
    variables: [
      { name: 'code', label: 'Código OTP', required: true },
      { name: 'minutes', label: 'Minutos de vigencia', dataType: 'number' },
    ] },

  { code: 'password_reset_link', name: 'Restablecer contraseña (enlace)',
    subject: 'Password Reset Request',
    blocks: [
      { id: 'p', type: 'paragraph', text: 'Para restablecer tu contraseña, haz clic en el siguiente enlace:' },
      { id: 'b', type: 'button', text: 'Restablecer contraseña', url: '{{resetLink}}' },
    ],
    variables: [{ name: 'resetLink', label: 'Enlace de restablecimiento', required: true }] },

  { code: 'generic_notification', name: 'Notificación genérica',
    subject: '{{title}}',
    blocks: [
      { id: 'h', type: 'heading', text: '{{title}}' },
      { id: 'p', type: 'paragraph', text: '{{body}}' },
      { id: 'b', type: 'button', text: 'Abrir en PMY', url: '{{link}}', when: 'link' },
    ],
    variables: [
      { name: 'title', label: 'Título' },
      { name: 'body', label: 'Cuerpo' },
      { name: 'link', label: 'Enlace' },
    ] },
];

interface SeedRepos {
  tplRepo: Repository<DocumentTemplate>;
  verRepo: Repository<DocumentTemplateVersion>;
  varRepo: Repository<TemplateVariableDef>;
}

/** Upsert idempotente por `code`. Si la plantilla ya existe, no la duplica. */
export async function seedEmailTemplates(repos: SeedRepos): Promise<void> {
  const composer = new BlockComposer();
  for (const seed of EMAIL_TEMPLATE_SEEDS) {
    let template = await repos.tplRepo.findOne({ where: { code: seed.code } });
    if (!template) {
      template = await repos.tplRepo.save(repos.tplRepo.create({
        code: seed.code, name: seed.name, type: 'email', language: 'es', active: true, category: 'correo',
      }));
    }
    let version = await repos.verRepo.findOne({ where: { templateId: template.id, version: 1 } });
    if (!version) {
      version = await repos.verRepo.save(repos.verRepo.create({
        templateId: template.id, version: 1, status: 'published',
        subject: seed.subject,
        designJson: blocksToUnlayerDesign(seed.blocks),
        compiledBody: composer.compose({ blocks: seed.blocks }),
        engine: 'handlebars',
        changelog: 'Seed inicial (bloques, paridad con legacy)', publishedAt: new Date(),
      }));
    } else if (typeof version.changelog === 'string' && version.changelog.startsWith('Seed')) {
      // No fue editada por el usuario (changelog sigue siendo el del seed): refrescar
      // designJson al formato Unlayer (el editor no entiende { blocks: [...] }).
      version.designJson = blocksToUnlayerDesign(seed.blocks);
      version.compiledBody = composer.compose({ blocks: seed.blocks });
      await repos.verRepo.save(version);
    }
    if (!template.currentVersionId) {
      template.currentVersionId = version.id;
      await repos.tplRepo.save(template);
    }
    const existingVars = await repos.varRepo.find({ where: { templateId: template.id } });
    if (existingVars.length === 0) {
      await repos.varRepo.save(seed.variables.map((v) => repos.varRepo.create({
        templateId: template.id, name: v.name, label: v.label,
        dataType: (v.dataType as any) ?? 'string', example: v.example ?? null, required: v.required ?? false,
      })));
    }
  }
}
