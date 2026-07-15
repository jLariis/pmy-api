import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';

export interface EmailSeedVar { name: string; label: string; dataType?: string; example?: string; required?: boolean; }
export interface EmailSeed { code: string; name: string; subject: string; body: string; variables: EmailSeedVar[]; }

/** Cuerpo MJML base branded reutilizable. `{{{content}}}` recibe HTML del bloque específico. */
const wrap = (content: string) => `<mjml><mj-body background-color="#f4f4f4">
  <mj-section background-color="#ffffff"><mj-column>
    <mj-text font-size="18px" font-weight="bold" color="{{brand.colors.secondary}}">{{brand.fiscal.razonSocial}}</mj-text>
    ${content}
    <mj-divider border-color="#eeeeee" />
    <mj-text font-size="12px" color="#7f8c8d">Este correo fue enviado automáticamente por el sistema. Por favor, no responda a este mensaje.<br/>{{brand.contact.website}}</mj-text>
  </mj-column></mj-section>
</mj-body></mjml>`;

/** Inventario de correos (spec §9). Paridad: cada variable actual está declarada. */
export const EMAIL_TEMPLATE_SEEDS: EmailSeed[] = [
  {
    code: 'route_dispatch',
    name: 'Salida a Ruta',
    subject: 'Salida a ruta - {{driverName}} - {{formatDate createdAt}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Salida a Ruta</mj-text>
      <mj-text>Se generó un reporte de <b>Salida a Ruta</b> para la sucursal <b>{{subsidiaryName}}</b> en la unidad <b>{{vehicleName}}</b>.</mj-text>
      <mj-text><b>Fecha y hora:</b> {{formatDate createdAt}}<br/><b>Responsable(s):</b> {{drivers}}<br/><b>Ruta(s):</b> {{routes}}<br/><b>Seguimiento:</b> {{trackingNumber}}</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'drivers', label: 'Responsables' },
      { name: 'routes', label: 'Rutas' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
      { name: 'driverName', label: 'Chofer principal' },
    ],
  },
  {
    code: 'unloading',
    name: 'Desembarque',
    subject: '🚚 Desembarque {{formatDate createdAt}} de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Desembarque</mj-text>
      <mj-text>Se generó un reporte de <b>Desembarque</b> para la sucursal <b>{{subsidiaryName}}</b> descargado de la unidad <b>{{vehicleName}}</b>.</mj-text>
      <mj-text><b>Fecha y hora:</b> {{formatDate createdAt}}<br/><b>Seguimiento:</b> {{trackingNumber}}</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'vehicleName', label: 'Unidad' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
    ],
  },
  {
    code: 'route_closure',
    name: 'Cierre de Ruta',
    subject: '🚚 CIERRE DE RUTA - {{driverName}} - {{formatDate createdAt}} DE {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Cierre de Ruta</mj-text>
      <mj-text>Se generó un reporte de <b>Cierre de Ruta</b> para la sucursal <b>{{subsidiaryName}}</b>.</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'driverName', label: 'Chofer' },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
    ],
  },
  {
    code: 'inventory_report',
    name: 'Inventario',
    subject: '📦 Inventario {{formatDate inventoryDate}} de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">📦 Reporte de Inventario</mj-text>
      <mj-text>Se generó un reporte de <b>Inventario</b> para la sucursal <b>{{subsidiaryName}}</b>.</mj-text>
      <mj-text><b>Fecha:</b> {{formatDate inventoryDate}}<br/><b>Seguimiento:</b> {{trackingNumber}}</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'inventoryDate', label: 'Fecha de inventario', dataType: 'date' },
      { name: 'trackingNumber', label: 'Número de seguimiento' },
    ],
  },
  {
    code: 'devolutions',
    name: 'Devoluciones/Recolecciones',
    subject: '🚚 Devoluciones/Recolecciones {{formatDate createdAt}} de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.primary}}">🚚 Reporte de Devoluciones/Recolecciones</mj-text>
      <mj-text>Se generó un reporte de <b>Devoluciones/Recolecciones</b> para la sucursal <b>{{subsidiaryName}}</b>.</mj-text>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'createdAt', label: 'Fecha y hora', dataType: 'date' },
    ],
  },
  {
    code: 'dex03_report',
    name: 'Paquetes con status DEX03',
    subject: '🚨🚥 Paquetes con status DEX03 de {{subsidiaryName}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Reporte de Paquetes con DEX03 — {{subsidiaryName}}</mj-text>
      <mj-text>Se detectaron los siguientes envíos con status DEX03. Considere la fecha de recepción ({{formatDate today}}) para su seguimiento.</mj-text>
      <mj-table><tr style="text-align:left;border-bottom:1px solid #ddd"><th>Tracking</th><th>Nombre</th><th>Dirección</th><th>CP</th><th>Fecha</th><th>Por</th><th>Teléfono</th></tr>
      {{#each rows}}<tr><td>{{this.trackingNumber}}</td><td>{{this.recipientName}}</td><td>{{this.recipientAddress}}</td><td>{{this.recipientZip}}</td><td>{{this.timestamp}}</td><td>{{this.doItByUser}}</td><td>{{this.recipientPhone}}</td></tr>{{/each}}
      </mj-table>`),
    variables: [
      { name: 'subsidiaryName', label: 'Sucursal', required: true },
      { name: 'today', label: 'Fecha del reporte', dataType: 'date' },
      { name: 'rows', label: 'Filas (envíos DEX03)' },
    ],
  },
  {
    code: 'high_priority_shipments',
    name: 'Envíos Prioridad Alta en Curso',
    subject: '🔴 Envíos con Prioridad Alta en Curso',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Envíos con Prioridad Alta en Curso</mj-text>
      <mj-raw>{{{tableHtml}}}</mj-raw>`),
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }],
  },
  {
    code: 'unloading_priority_packages',
    name: 'Envíos Prioridad Alta en Descarga',
    subject: '🔴 Envíos con Prioridad Alta en Descarga',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Envíos con Prioridad Alta en Descarga</mj-text>
      <mj-raw>{{{tableHtml}}}</mj-raw>`),
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }],
  },
  {
    code: 'inventory_priority_packages',
    name: 'Envíos Prioridad Alta en Inventario',
    subject: '🔴 Envíos con Prioridad Alta en Inventario',
    body: wrap(`<mj-text font-size="16px" font-weight="bold" color="{{brand.colors.button}}">Envíos con Prioridad Alta en Inventario</mj-text>
      <mj-raw>{{{tableHtml}}}</mj-raw>`),
    variables: [{ name: 'tableHtml', label: 'Tabla HTML de envíos prioritarios' }],
  },
  {
    code: 'password_reset_otp',
    name: 'Código de recuperación (OTP)',
    subject: 'Tu código de recuperación: {{code}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold">Recuperación de contraseña — PMY App</mj-text>
      <mj-text>Usa este código para restablecer tu contraseña. Vence en {{minutes}} minutos.</mj-text>
      <mj-text align="center" font-size="32px" font-weight="bold" letter-spacing="8px">{{code}}</mj-text>
      <mj-text color="#94a3b8" font-size="12px">Si no solicitaste este código, ignora este correo.</mj-text>`),
    variables: [
      { name: 'code', label: 'Código OTP', required: true },
      { name: 'minutes', label: 'Minutos de vigencia', dataType: 'number' },
    ],
  },
  {
    code: 'password_reset_link',
    name: 'Restablecer contraseña (enlace)',
    subject: 'Password Reset Request',
    body: wrap(`<mj-text>Para restablecer tu contraseña, haz clic en el siguiente enlace:</mj-text>
      <mj-button href="{{resetLink}}" background-color="{{brand.colors.button}}">Restablecer contraseña</mj-button>`),
    variables: [{ name: 'resetLink', label: 'Enlace de restablecimiento', required: true }],
  },
  {
    code: 'generic_notification',
    name: 'Notificación genérica',
    subject: '{{title}}',
    body: wrap(`<mj-text font-size="16px" font-weight="bold">{{title}}</mj-text>
      <mj-text>{{body}}</mj-text>
      {{#if link}}<mj-button href="{{link}}" background-color="{{brand.colors.button}}">Abrir en PMY</mj-button>{{/if}}`),
    variables: [
      { name: 'title', label: 'Título' },
      { name: 'body', label: 'Cuerpo' },
      { name: 'link', label: 'Enlace' },
    ],
  },
];

interface SeedRepos {
  tplRepo: Repository<DocumentTemplate>;
  verRepo: Repository<DocumentTemplateVersion>;
  varRepo: Repository<TemplateVariableDef>;
}

/** Upsert idempotente por `code`. Si la plantilla ya existe, no la duplica. */
export async function seedEmailTemplates(repos: SeedRepos): Promise<void> {
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
        subject: seed.subject, compiledBody: seed.body, engine: 'handlebars',
        changelog: 'Seed inicial (paridad con código legacy)', publishedAt: new Date(),
      }));
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
