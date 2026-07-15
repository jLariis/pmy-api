# Motor de Plantillas Configurable — Fase 1: Núcleo + Email (GrapesJS)

> **Spec de diseño.** Fase 1 de un rediseño mayor del sistema de generación de documentos.
> Autor: Javier · Fecha: 2026-07-11 · Branch: `feat/template-engine`

## 1. Problema y estado actual

Hoy cada documento (correo, PDF, Excel) se genera de forma ad-hoc, con formato, colores, textos, logos y estructura **hardcodeados en el código**:

- **Emails:** `src/mail/mail.service.ts` (~650 líneas de HTML embebido) y `src/auth/email.service.ts`. Colores (`#3498db`), URLs (`https://app-pmy.vercel.app/`), pies de página, emojis y destinatarios viven en TypeScript.
- **Excel:** `exceljs` disperso en `monitoring`, `resports`, `shipments`, `inventories`, `package-dispatch`, `warehouse`.
- **PDF:** `pdfkit` / `pdfmake` (`warehouse.toPdfSafe()` y otros).
- **Ya existe** un subsistema de notificaciones con patrón **catálogo + `resolvePresentation()` + dispatch best-effort** (`src/notifications/`). El motor extiende esa filosofía, no la reemplaza.

**Objetivo del proyecto completo:** que ningún texto, color, logo, encabezado, pie o estructura quede hardcodeado; que todo documento se genere desde plantillas configurables por un administrador; y que exista un servicio único `TemplateService.render(code, data)` compartido por todos los formatos.

**Esta Fase 1** construye el **núcleo del motor** + el **renderer de Email** + **admin/versionado/branding/editor GrapesJS**, y **migra todos los correos actuales** preservando cada variable (paridad). PDF y Excel son fases posteriores con sus propios specs, pero el núcleo se diseña una sola vez para todos.

## 2. Decisiones tomadas (contexto de brainstorming)

| Decisión | Elección |
|---|---|
| Punto de partida | **Núcleo + Email** primero |
| Multi-tenant | **Diseñar para el futuro, no construir** (columnas/scoping presentes, lógica single-tenant) |
| Editor visual | **GrapesJS** (OSS, self-hosted, sin lock-in) con preset MJML |
| Branding | **Solo global** (una identidad para todo PMY; sin override por sucursal) |
| Fallback | **Siempre emitir** — si la plantilla falta/inactiva/falla, usar base genérica + warn/notify; nunca romper la operación |
| Idiomas | **Español ahora**, esquema listo (`language` + índice `(code, language)`) |
| Migración | **Paridad total**: todos los documentos actuales deben existir en el nuevo diseño conservando todas sus variables |

## 3. Restricciones del stack (obligatorias)

- NestJS + TypeORM (**MySQL**). Entidades auto-cargadas por glob `src/entities/*.entity.{js,ts}`; exportar desde el barrel `src/entities/index.ts`.
- PKs: `@PrimaryGeneratedColumn('uuid')`. Timestamps: `@Column({ type: 'datetime' })`.
- Prefijo global de rutas: `api`. Guard existente: `superadmin`. Interceptor de auditoría existente registra quién/cuándo/qué en mutaciones.
- **Regla best-effort:** ningún efecto lateral (email, log de render, notificación) puede romper la request que lo originó. `render()` **nunca lanza** al llamador.
- Cambios de esquema como migración en `src/database/migrations/`; dev puede usar `DB_SYNC=true`.
- Tests: unit tests puros (instanciar servicios con repos mock, sin `Test.createTestingModule`). `npm test`.
- Zona horaria de negocio: `America/Hermosillo` (ver `formatToHermosillo` en `src/common/utils`).

## 4. Arquitectura — capas

```
┌─────────────────────────────────────────────────────────────┐
│ CONSUMIDORES  (shipments, warehouse, monitoring, auth, …)    │
│   templateService.render('route_dispatch', data)            │
└───────────────────────────┬─────────────────────────────────┘
                            │  RenderRequest
┌───────────────────────────▼─────────────────────────────────┐
│ NÚCLEO DEL MOTOR  (módulo: src/documents/)                   │
│  TemplateService   ─ orquesta render + fallback + logging    │
│  TemplateStore     ─ carga+cachea versión publicada activa   │
│  VariableResolver  ─ mezcla data + branding + system; valida │
│  TemplateEngine    ─ interpolación Handlebars ({{ }}) segura │
│  BrandingService   ─ tokens de Brand global (cacheado)       │
│  RendererRegistry  ─ type → Renderer                         │
│  FallbackRenderer  ─ plantilla base genérica (siempre emite) │
└───────────────────────────┬─────────────────────────────────┘
              ┌──────────────┼───────────────┐
      ┌───────▼──────┐ ┌─────▼──────┐  ┌──────▼───────┐
      │ EmailRenderer│ │ PdfRenderer│  │ ExcelRenderer│  (Fase 2/3)
      │  (Fase 1)    │ │  (después) │  │  (después)   │
      └───────┬──────┘ └────────────┘  └──────────────┘
              │ RenderResult { html, subject, mime | buffer, filename }
      MailService = solo transporte (sin HTML embebido)
```

El motor es un módulo nuevo `src/documents/`. En Fase 1 solo se registra `EmailRenderer`; el registry y las interfaces ya admiten los demás formatos sin tocar el núcleo.

## 5. Modelo de datos

```
Brand (1 fila global)
  └─ tokens consumidos por cada render

DocumentTemplate  (code UNIQUE, type, active, currentVersionId, language)
  │ 1───* DocumentTemplateVersion   (historial inmutable; versión N)
  │ 1───* TemplateVariableDef        (variables declaradas → paleta editor + validación + sample)
  └─ currentVersionId ──► versión publicada usada al render

TemplateRenderLog  (observabilidad best-effort: code, version, format, status, ms, error)
Auditoría de ediciones/restauraciones → interceptor de auditoría EXISTENTE (sin tabla nueva)
```

### 5.1 Entidades (TypeORM)

```ts
// src/entities/brand.entity.ts
@Entity('brand')
export class Brand {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40, default: 'default' }) key: string; // singleton 'default'
  @Column({ type: 'varchar', length: 500, nullable: true }) logoLight: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) logoDark: string | null;
  @Column({ type: 'json', nullable: true }) colors: BrandColors | null;      // primary/secondary/button/text/bg
  @Column({ type: 'json', nullable: true }) typography: BrandTypography | null; // fontFamily/sizes
  @Column({ type: 'varchar', length: 20, nullable: true }) borderRadius: string | null;
  @Column({ type: 'json', nullable: true }) spacing: Record<string, string> | null;
  @Column({ type: 'json', nullable: true }) fiscal: BrandFiscal | null;      // razónSocial/RFC/dirección
  @Column({ type: 'json', nullable: true }) contact: BrandContact | null;    // phone/email/website
  @Column({ type: 'json', nullable: true }) social: BrandSocial | null;      // fb/ig/wa/…
  @Column({ type: 'char', length: 36, nullable: true }) tenantId: string | null; // reservado multi-tenant
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) updatedAt: Date;
}
```

```ts
// src/entities/document-template.entity.ts
export type DocumentFormat =
  | 'email' | 'pdf' | 'excel' | 'report' | 'letter' | 'receipt' | 'label' | 'statement';

@Entity('document_template')
@Index(['code', 'language'], { unique: true })
export class DocumentTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) code: string;          // 'route_dispatch'
  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'varchar', length: 20 }) type: DocumentFormat;
  @Column({ type: 'varchar', length: 300, nullable: true }) description: string | null;
  @Column({ type: 'varchar', length: 8, default: 'es' }) language: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ type: 'varchar', length: 60, nullable: true }) category: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) currentVersionId: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) tenantId: string | null; // reservado
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) updatedAt: Date;
}
```

```ts
// src/entities/document-template-version.entity.ts
export type VersionStatus = 'draft' | 'published' | 'archived';

@Entity('document_template_version')
@Index(['templateId', 'version'], { unique: true })
export class DocumentTemplateVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'char', length: 36 }) templateId: string;
  @Column({ type: 'int' }) version: number;                       // incremental por template
  @Column({ type: 'varchar', length: 20, default: 'draft' }) status: VersionStatus;
  @Column({ type: 'varchar', length: 300, nullable: true }) subject: string | null; // email; Handlebars
  @Column({ type: 'json', nullable: true }) designJson: any;      // fuente de verdad del editor (GrapesJS)
  @Column({ type: 'longtext', nullable: true }) compiledBody: string | null; // MJML/HTML producido por editor
  @Column({ type: 'varchar', length: 20, default: 'handlebars' }) engine: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) changelog: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) createdById: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) createdByName: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', nullable: true }) publishedAt: Date | null;
}
```

```ts
// src/entities/template-variable-def.entity.ts
export type VariableDataType = 'string' | 'number' | 'date' | 'currency' | 'boolean';

@Entity('template_variable_def')
@Index(['templateId'])
export class TemplateVariableDef {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'char', length: 36 }) templateId: string;
  @Column({ type: 'varchar', length: 80 }) name: string;          // 'tracking'
  @Column({ type: 'varchar', length: 160 }) label: string;
  @Column({ type: 'varchar', length: 20, default: 'string' }) dataType: VariableDataType;
  @Column({ type: 'varchar', length: 300, nullable: true }) example: string | null;
  @Column({ type: 'boolean', default: false }) required: boolean;
}
```

```ts
// src/entities/template-render-log.entity.ts
export type RenderStatus = 'ok' | 'fallback' | 'error';

@Entity('template_render_log')
@Index(['code', 'createdAt'])
export class TemplateRenderLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) code: string;
  @Column({ type: 'int', default: 0 }) version: number;
  @Column({ type: 'varchar', length: 20 }) format: string;
  @Column({ type: 'varchar', length: 20 }) status: RenderStatus;
  @Column({ type: 'varchar', length: 64, nullable: true }) entityId: string | null;
  @Column({ type: 'int', nullable: true }) ms: number | null;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
```

**Reglas de integridad:**
- `document_template` único por `(code, language)`; hoy solo poblamos `es`.
- Versiones **inmutables** una vez `published`. "Restaurar vN" = crear una nueva versión clonando el `designJson`/`compiledBody`/`subject` de vN (auditado).
- `currentVersionId` apunta a la única versión `published` activa.

## 6. Backend (NestJS) — estructura, servicios, interfaces, DTOs

```
src/documents/
  documents.module.ts
  template.service.ts            # render() — API pública única
  template-store.service.ts      # carga+cachea versión publicada; invalida al publicar
  variable-resolver.service.ts   # mezcla data + branding + system; valida required
  branding.service.ts            # tokens de Brand global (cacheado)
  template-engine.ts             # Handlebars: compile/execute + helpers seguros
  renderer.registry.ts           # type → Renderer
  fallback.renderer.ts           # plantilla base genérica (siempre emite)
  renderers/
    renderer.interface.ts        # contrato DocumentRenderer
    email.renderer.ts            # Fase 1 (MJML/HTML → html + subject)
    # pdf.renderer.ts  excel.renderer.ts  ← fases posteriores, sin tocar el núcleo
  seeds/
    email-templates.seed.ts      # semilla idempotente de TODOS los emails actuales
  admin/
    templates.controller.ts      # CRUD + versionado + publish + restore + preview + test-send
    brand.controller.ts          # editor de Brand global
    dto/*.dto.ts
```

### 6.1 Contratos del núcleo (el corazón reutilizable)

```ts
// renderers/renderer.interface.ts
export interface RenderContext {
  data: Record<string, any>;      // payload del módulo
  brand: BrandTokens;             // branding global resuelto
  system: { now: Date; appUrl: string; env: string };
}

export interface RenderResult {
  format: DocumentFormat;
  mime: string;                   // text/html, application/pdf, xlsx…
  filename?: string;
  html?: string;                  // email/preview
  subject?: string;               // email
  buffer?: Buffer;                // pdf/excel (adjuntos)
}

export interface DocumentRenderer {
  readonly format: DocumentFormat;
  render(version: DocumentTemplateVersion, ctx: RenderContext): Promise<RenderResult>;
}
```

```ts
// template.service.ts — API única para TODOS los módulos
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  async render(code: string, data: Record<string, any>): Promise<RenderResult> {
    const started = Date.now();
    try {
      const { template, version } = await this.store.getActive(code);       // + validación active
      const renderer = this.registry.get(template.type);                    // dispatch por type
      const ctx = await this.resolver.build(template, data);                // data+brand+system, valida required
      const result = await renderer.render(version, ctx);
      void this.logRender(code, version.version, result.format, 'ok', started);
      return result;
    } catch (err: any) {
      this.logger.warn(`render(${code}) fallback: ${err?.message}`);         // SIEMPRE emite
      void this.logRender(code, 0, 'email', 'fallback', started, err);
      return this.fallback.render(code, data);                              // nunca lanza
    }
  }

  // renderPreview(code, sampleData) y sendTest(code, to, sampleData) reutilizan render()
}
```

`renderEmail()/renderPDF()/renderExcel()` del brief **no son métodos separados**: son el mismo `render()` despachando por `template.type`. Eso elimina la duplicación. (Se pueden exponer wrappers tipados finos si se prefiere ergonomía.)

### 6.2 DTOs (admin, todos bajo `@Roles('superadmin')`)

`CreateTemplateDto`, `UpdateTemplateVersionDto` (designJson, compiledBody, subject, changelog), `PublishVersionDto`, `RestoreVersionDto` (fromVersion), `TestSendDto` (to, sampleData), `UpsertBrandDto`, `PreviewDto` (sampleData).

### 6.3 Seguridad y auditoría

Todos los endpoints de escritura detrás del guard `superadmin`. El interceptor de auditoría existente registra crear/actualizar/publicar/restaurar (quién, cuándo, versión). Como las versiones son inmutables, el historial "quién modificó / versión / restauraciones" es inherente a las filas de versión + log de auditoría.

## 7. Flujo de render (extremo a extremo)

```
shipments.service ──► templateService.render('route_dispatch', packageDispatch)
                          │
   TemplateStore.getActive('route_dispatch') ─(cache)→ template + versión publicada
                          │
   VariableResolver.build → { data: packageDispatch, brand: BrandingService.get(), system }
        └─ valida TemplateVariableDef.required; faltante → default + warn
                          │
   RendererRegistry.get('email') → EmailRenderer
        └─ Handlebars(compiledBody + subject) con ctx → MJML → HTML responsivo
                          │
   RenderResult { html, subject, mime: text/html }
                          │
   MailService.send(to, subject, html, attachments)   ← solo transporte
                          │
   TemplateRenderLog: ok, 42ms
  (cualquier fallo arriba → FallbackRenderer → el correo IGUAL sale → warn + notify)
```

## 8. Frontend (Next.js + React) — Configuración → Plantillas

Sigue patrones existentes (filtros en `OperationHeader`, config-driven). Repo frontend: `D:\PMY\app-pmy`.

```
configuracion/plantillas/
  page.tsx                 # lista: código, nombre, tipo, activa, versión, idioma (filtros en OperationHeader)
  [code]/page.tsx          # workspace del editor
    ├─ EmailEditor         # GrapesJS + grapesjs-mjml — drag&drop, exporta designJson + compiledBody
    ├─ VariablePalette     # de TemplateVariableDef — clic para insertar {{var}}
    ├─ VersionHistory      # versiones, diff, "Restaurar"
    ├─ LivePreview         # render server con sample data (renderPreview)
    └─ TestActions         # "Enviar prueba" (Fase 1). Después: "Generar PDF/Excel de prueba"
  branding/page.tsx        # Brand global: logos, colores, tipografía, fiscal, contacto, redes
```

**Editor: GrapesJS + `grapesjs-mjml` (MIT, self-hosted).** Exporta MJML que compilamos en server → email responsivo garantizado; guarda `designJson` para re-edición (round-trip). Preview y test-send corren **server-side** por el mismo `render()`, así el admin ve exactamente lo que recibe el destinatario.

## 9. Inventario de correos — checklist de paridad (Fase 1)

Cada documento actual → una plantilla con su `code`, su set de variables y su envío. **Criterio de aceptación:** cada uno se recrea sin perder variables. Los adjuntos (PDF/Excel) siguen generándose con el código actual en Fase 1; se migran en Fases 2/3.

### 9.1 `src/mail/mail.service.ts`

| code | Asunto (actual) | Variables | Envío / adjuntos |
|---|---|---|---|
| `route_dispatch` | `Salida a ruta - {driver} - {fecha}` | `subsidiaryName`, `vehicle.name`, `createdAt`, `drivers[]`, `routes[]`, `trackingNumber` | to: `subsidiary.officeEmail`; cc: `officeEmailToCopy` + sistemas; adjunta **PDF + Excel** |
| `unloading` | `🚚 Desembarque {fecha} de {subsidiary}` | `subsidiaryName`, `vehicle.name`, `createdAt`, `trackingNumber` | to/cc igual; adjunta **PDF + Excel** |
| `route_closure` | `🚚 CIERRE DE RUTA - {driver} - {fecha} DE {subsidiary}` | `subsidiary.name`, `packageDispatch.drivers[0].name`, `createdAt` | to/cc igual; adjunta **PDF + Excel** |
| `inventory_report` | `📦 Inventario {fecha} de {subsidiary}` | `subsidiaryName`, `inventory.inventoryDate`, `trackingNumber` | to/cc igual; adjunta **PDF + Excel** |
| `devolutions` | `🚚 Devoluciones/Recolecciones {fecha} de {subsidiary}` | `subsidiary.name` | to/cc igual; adjunta **PDF + Excel** |
| `dex03_report` | `🚨🚥 Paquetes con status DEX03 de {subsidiary}` | `subsidiary.name`, `today`; **tabla:** `trackingNumber`, `recipientName`, `recipientAddress`, `recipientZip`, `timestamp`, `doItByUser`, `recipientPhone` | destinatarios múltiples (hotmail + fijos + officeEmail/copy); headers alta prioridad |
| `high_priority_shipments` | `🔴 Envíos con Prioridad Alta en Curso` | tabla de envíos prioritarios (HTML lo arma el llamador — capturar columnas en implementación) | headers alta prioridad |
| `unloading_priority_packages` | `🔴 Envíos con Prioridad Alta en Descarga` | tabla prioritarios (llamador) | — |
| `inventory_priority_packages` | `🔴 Envíos con Prioridad Alta en Inventario` | tabla prioritarios (llamador) | — |

> `sendEmailNotification()` es un emisor genérico (subject + htmlContent) — se conserva como transporte, no es un documento con plantilla propia.

### 9.2 `src/auth/email.service.ts`

| code | Asunto | Variables |
|---|---|---|
| `password_reset_link` | `Password Reset Request` | `resetLink` (token) — texto plano |
| `password_reset_otp` | `Tu código de recuperación: {code}` | `code`, `minutes` |

### 9.3 `src/notifications/notification-dispatch.service.ts`

| code | Uso | Variables |
|---|---|---|
| `generic_notification` | HTML de campana → email | `title`, `body`, `link` |

> **Pendiente de captura durante implementación (parity):** notificación unificada de `warehouse` (entrada/ruta/traslado — commits recientes) y las columnas exactas de las tablas de "paquetes prioritarios". El inventario detallado se completa al migrar cada documento; ninguno se da por migrado hasta cumplir paridad de variables.

## 10. Estrategia de migración y corte (sin romper operación)

- **Por documento, con flag individual.** Cada `code` se migra detrás de un check (p.ej. `template.active` + feature flag). Si su plantilla no está lista o falla → **FallbackRenderer** o comportamiento actual. Migramos de a uno.
- **`applyDevFilters` se conserva** en `MailService` (en dev redirige a correo de sistemas) — es transporte, no plantilla.
- **Refactor de `MailService`:** los métodos `sendHighPriority*` pasan a: `const r = await templateService.render(code, data); await this.transport(to, cc, r);`. El HTML embebido se elimina cuando cada `code` alcanza paridad.
- **Seed idempotente** crea las 12 plantillas de email con sus `TemplateVariableDef`. Correrlo dos veces no duplica (upsert por `code`).

## 11. Extensibilidad (agregar formatos/documentos sin tocar código existente)

- **Nuevo formato (PDF/Excel):** crear `pdf.renderer.ts` / `excel.renderer.ts` implementando `DocumentRenderer`, registrarlo en `RendererRegistry`. PDF recomendado: reutiliza el pipeline HTML/Handlebars → HTML→PDF con Chromium headless (`playwright-core`), compartiendo branding/variables con email. Excel: `ExcelRenderer` dirigido por config de columnas (JSON) sobre `exceljs`. **Sin editar `TemplateService` ni consumidores.**
- **Nuevo documento:** el admin lo crea en la UI (code + type + versión). Cero código. Un módulo lo consume con `render('nuevo_code', data)`.
- **Nueva variable:** agregar un `TemplateVariableDef`; aparece en la paleta del editor y en el sample automáticamente.

## 12. Librerías recomendadas

| Necesidad | Librería | Por qué |
|---|---|---|
| Interpolación de variables | **Handlebars** | Logic-less, seguro, sintaxis `{{ }}` idéntica a la pedida |
| Compilar email responsivo | **mjml** | HTML responsivo probado; pareja del editor |
| Editor visual | **grapesjs** + **grapesjs-mjml** | MIT, self-hosted, round-trip designJson |
| Transporte de correo | **@nestjs-modules/mailer** (existente) | Ya cableado; queda como transporte puro |
| PDF (Fase 2) | **playwright-core** HTML→PDF (legacy: mantener pdfmake) | Reutiliza el pipeline de email; config-driven |
| Excel (Fase 3) | **exceljs** (existente) | Modelo de plantilla por config de columnas |

## 13. Alcance

**En este spec (Fase 1):**
- Módulo `src/documents/` con núcleo completo (TemplateService, Store, VariableResolver, TemplateEngine, BrandingService, RendererRegistry, FallbackRenderer).
- Todas las entidades + migración.
- `EmailRenderer` (Handlebars + MJML).
- Admin CRUD + versionado + publish + **restore** + **preview** + **test-send** (`superadmin` + auditoría).
- Editor de **Brand global**.
- Integración **GrapesJS** en `app-pmy`.
- **Seed + migración de todos los correos actuales** con paridad de variables.
- Columnas multi-tenant/i18n presentes; lógica single-tenant / `es`.

**Fuera (specs posteriores):** `PdfRenderer` + recreación de todos los PDFs; `ExcelRenderer` + recreación de todos los Excel (con columnas exactas); tipos restantes (etiquetas, estados de cuenta, comprobantes); activación multi-tenant; contenido multi-idioma.

## 14. Criterios de aceptación

1. `templateService.render(code, data)` devuelve `RenderResult` para cada `code` de email del inventario y **nunca lanza** (fallback en error).
2. Cada correo del §9 se genera desde plantilla conservando **todas** sus variables (paridad verificada contra el output actual).
3. Un admin puede: crear/editar plantilla en GrapesJS, insertar variables desde la paleta, ver preview con sample data, enviar prueba, publicar, ver historial y **restaurar** una versión previa.
4. El Brand global edita logos/colores/tipografía/fiscal/contacto/redes y esos tokens aparecen en los correos renderizados.
5. Ediciones/publicaciones/restauraciones quedan auditadas.
6. Solo `superadmin` modifica plantillas y branding.
7. `npm run build` y `npm test` en verde; migración aplica limpia.

## 15. Preguntas abiertas

- ¿Los adjuntos PDF/Excel de los correos (salida a ruta, desembarque, etc.) se mantienen generados por el código legacy durante Fase 1 (recomendado) o quieres adelantar su migración? — *asumido: legacy en Fase 1.*
- ¿El editor GrapesJS se monta como página propia en `app-pmy` o como módulo embebible reutilizable? — *asumido: página propia bajo `configuracion/plantillas`.*
