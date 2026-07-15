# Motor de Plantillas — Fase 2: Frontend (Configuración → Plantillas + Branding, editor GrapesJS)

> **Spec de diseño.** Fase 2 del rediseño del sistema de generación de documentos.
> Autor: Javier · Fecha: 2026-07-15 · Repos: `app-pmy` (frontend, grueso del trabajo) + `pmy-api` (una adición de endpoint).

## 1. Contexto

La **Fase 1 backend** (mergeada a `main` en `pmy-api`) entregó el motor `TemplateService.render(code, data)`, las entidades/migración, el `EmailRenderer` (Handlebars→MJML), el seed de los 12 correos actuales con paridad de variables, y los endpoints de administración bajo `SuperAdminGuard`:

- `GET /api/documents/templates` — lista
- `GET /api/documents/templates/:code` — por código
- `POST /api/documents/templates` — crear
- `POST /api/documents/templates/:id/draft` — guardar borrador (crea/actualiza la versión draft de mayor número)
- `POST /api/documents/templates/:id/publish` — publicar `{ versionId }`
- `POST /api/documents/templates/:id/restore` — restaurar `{ fromVersionId }` (clona en nuevo draft)
- `GET /api/documents/templates/:id/versions` — historial
- `POST /api/documents/templates/:code/preview` — render de la versión **publicada** con `{ sampleData }`
- `POST /api/documents/templates/:id/versions/:versionId/preview` — render de una versión **específica (borrador)** con `{ sampleData }`
- `POST /api/documents/templates/:code/test-send` — `{ to, sampleData }` (pasa por `applyDevFilters`: en dev redirige a `javier.rappaz@gmail.com`)
- `GET /api/documents/brand` · `PUT /api/documents/brand`

Hoy **no hay UI**: las plantillas se administran por API o por el seed. Esta Fase 2 construye la UI en `app-pmy` para que un administrador liste, edite (editor visual), versione, previsualice, pruebe y publique plantillas, y edite el branding global.

## 2. Decisiones (contexto de brainstorming)

| Decisión | Elección |
|---|---|
| Ubicación del editor | Lista como **sección dentro de Configuración**; editor GrapesJS en **ruta full-page propia** (`app/configuracion/plantillas/[id]`) |
| Datos de prueba (preview/test-send) | **Auto desde el `example` de cada variable, editables** en un formulario |
| Alcance | **Plantillas + Branding** (ambos) |
| Integración GrapesJS | **Vanilla `grapesjs` + `grapesjs-mjml`** vía componente client con dynamic import `ssr:false` (seguro para React 19) |
| Roles | Secciones "Plantillas" y "Branding" visibles **solo superadmin**; el backend ya lo exige con `SuperAdminGuard` |
| CRUD de variables por UI | **Diferido** (YAGNI): la paleta lee las variables sembradas; el motor interpola cualquier `{{var}}` que reciba |

## 3. Restricciones del stack (obligatorias)

**Frontend `app-pmy`:** Next 16 (app router), React 19, TypeScript. Componentes shadcn-style en `@/components/ui/*` (Card, Button, Badge, Tabs, Select, Label, Switch, Dialog vía Radix, Input, Table si existe), util `cn()` (`lib/utils`), Tailwind, iconos `lucide-react`. Cliente HTTP: `axiosConfig` de `lib/axios-config` (baseURL ya apunta al `/api`). Auth: `useAuthStore` (`store/auth.store.ts`) para el rol; tipo `Role` en `lib/access/types.ts`; HOC `withAuth` para gating de página. Servicios en `lib/services/*.ts` (patrón: funciones que llaman `axiosConfig` y devuelven `res.data`, ver `lib/services/company-settings.ts`). Layout con `<AppLayout>` y encabezado `<OperationHeader>` (`components/shared/operation-header.tsx`). **Sin unit tests de UI** (convención del repo; la feature previa de *support* se verificó con typecheck). Verificación: `npm run build` (incluye `next build` + guard `check-no-stubs`) + `next lint` + Browser pane (dev en `-p 4000`). **`check-no-stubs` prohíbe dejar stubs/TODOs** en el código.

**Backend `pmy-api`:** NestJS + TypeORM. Añadir un endpoint respeta las convenciones existentes del `TemplatesController` (bajo `SuperAdminGuard`, prefijo `api`).

## 4. Adición de backend (`pmy-api`)

El editor necesita, en una sola carga: la plantilla, sus **variables** (`TemplateVariableDef`, para la paleta) y sus **versiones** (subject + compiledBody + designJson). Hoy `GET :code` devuelve solo la plantilla y no existe endpoint de variables. Se agrega:

- **`GET /api/documents/templates/:id/edit`** → `{ template, variables, versions }`.
  - `TemplateAdminService.getForEdit(id)`: `template = require(id)`; `variables = varRepo.find({ where: { templateId: id } })`; `versions = listVersions(id)` (DESC). Lanza `NotFoundException` si la plantilla no existe.
  - Ruta en `TemplatesController` (misma clase, ya bajo `SuperAdminGuard`).

Sin cambios de esquema. Es la única modificación de `pmy-api` en esta fase.

## 5. Arquitectura frontend (rutas + componentes)

```
app/configuracion/page.tsx  (MODIFICAR)
  └─ SECTIONS += { id:'plantillas', label:'Plantillas', icon: Mail } y { id:'branding', label:'Branding', icon: Palette }
       (ambas se filtran del arreglo si el rol no es superadmin)
     render: section==='plantillas' && <PlantillasPanel/> ; section==='branding' && <BrandingPanel/>

app/configuracion/plantillas/[id]/page.tsx  (CREAR — ruta full-page)
  └─ withAuth(TemplateEditorPage, 'configuracion')  dentro de <AppLayout>
     └─ <TemplateEditor templateId={id}/>

components/configuracion/plantillas/           (CREAR)
  plantillas-panel.tsx        # lista: tabla (código, nombre, tipo, activa) + botón "Nueva plantilla" (dialog crear) ; fila → router.push(`/configuracion/plantillas/${id}`)
  template-editor.tsx         # orquesta el editor: carga getForEdit(id); estado de subject/designJson/compiledBody; botones Guardar borrador / Publicar
  grapes-editor.tsx           # componente client, dynamic(()=>import(...), {ssr:false}); inicializa GrapesJS + grapesjs-mjml; expone onChange({designJson, mjml}) y carga inicial
  variable-palette.tsx        # lista TemplateVariableDef; cada una = bloque GrapesJS arrastrable que inserta `{{name}}` + botón copiar
  version-history.tsx         # lista versiones (número, estado, fecha, autor) + botón "Restaurar"
  preview-panel.tsx           # formulario de sampleData (auto-llenado desde variable.example, editable) + <iframe srcDoc={html}/> con el HTML del server
  test-send-dialog.tsx        # input destinatario + reutiliza sampleData → testSend(code, {to, sampleData})
  create-template-dialog.tsx  # form crear: code, name, type(email fijo en fase 2), description

components/configuracion/branding-panel.tsx    (CREAR)
  # formulario del Brand global: logoLight/logoDark (URL), colores (inputs color: primary/secondary/button/text/background),
  # typography (fontFamily/baseSize), borderRadius, fiscal (razonSocial/rfc/direccion), contact (phone/email/website), social (fb/ig/wa)
  # GET al montar, PUT al guardar

lib/services/document-templates.ts             (CREAR)
```

## 6. Capa de servicios (`lib/services/document-templates.ts`)

Tipos (espejo del backend) y funciones sobre `axiosConfig`:

```ts
export type DocumentFormat = 'email'|'pdf'|'excel'|'report'|'letter'|'receipt'|'label'|'statement';
export type VersionStatus = 'draft'|'published'|'archived';

export interface DocumentTemplate { id: string; code: string; name: string; type: DocumentFormat; description?: string|null; language: string; active: boolean; category?: string|null; currentVersionId?: string|null; }
export interface DocumentTemplateVersion { id: string; templateId: string; version: number; status: VersionStatus; subject?: string|null; designJson?: any; compiledBody?: string|null; changelog?: string|null; createdByName?: string|null; createdAt: string; publishedAt?: string|null; }
export interface TemplateVariableDef { id: string; templateId: string; name: string; label: string; dataType: 'string'|'number'|'date'|'currency'|'boolean'; example?: string|null; required: boolean; }
export interface Brand { id?: string; key?: string; logoLight?: string|null; logoDark?: string|null; colors?: Record<string,string>|null; typography?: Record<string,string>|null; borderRadius?: string|null; spacing?: Record<string,string>|null; fiscal?: Record<string,string>|null; contact?: Record<string,string>|null; social?: Record<string,string>|null; }
export interface RenderResult { format: string; mime: string; subject?: string; html?: string; }
export interface TemplateForEdit { template: DocumentTemplate; variables: TemplateVariableDef[]; versions: DocumentTemplateVersion[]; }

listTemplates(): Promise<DocumentTemplate[]>
getTemplateForEdit(id): Promise<TemplateForEdit>
createTemplate(dto: { code; name; type; description? }): Promise<DocumentTemplate>
saveDraft(id, { subject?, designJson?, compiledBody?, changelog? }): Promise<DocumentTemplateVersion>
publish(id, versionId): Promise<DocumentTemplate>
restore(id, fromVersionId): Promise<DocumentTemplateVersion>
listVersions(id): Promise<DocumentTemplateVersion[]>
previewVersion(id, versionId, sampleData): Promise<RenderResult>
previewPublished(code, sampleData): Promise<RenderResult>
testSend(code, { to, sampleData }): Promise<{ ok: boolean }>
getBrand(): Promise<Brand>
upsertBrand(payload: Partial<Brand>): Promise<Brand>
```

## 7. Integración GrapesJS ↔ el motor

- Preset **`grapesjs-mjml`**: el lienzo edita componentes MJML. Al guardar:
  - `compiledBody` = **string MJML** (el motor lo detecta por `<mjml` y lo compila con `mjml`). Con el preset, el MJML se obtiene del comando del preset (p.ej. `editor.getHtml()` bajo `grapesjs-mjml` devuelve MJML; el implementador confirma la API exacta del preset instalado).
  - `designJson` = `editor.getProjectData()` — fuente de verdad para re-editar.
- **Carga inicial**: si la versión tiene `designJson`, `editor.loadProjectData(designJson)`; si solo hay `compiledBody` (p.ej. plantillas del seed sin designJson), cargar los componentes desde el MJML (`editor.setComponents(compiledBody)` o el equivalente del preset).
- **Guardar es explícito** (botón "Guardar borrador") — no autosave. Publicar exige guardar primero (publica la versión draft actual).
- **Paleta de variables**: cada `TemplateVariableDef` se registra como bloque GrapesJS que, al arrastrarse al lienzo, inserta un texto `{{name}}`; además botón "copiar `{{name}}`" como respaldo.
- **Cliente-only**: `grapes-editor.tsx` se importa con `next/dynamic` `{ ssr: false }`; GrapesJS y su CSS se cargan solo en cliente. Los estilos de GrapesJS se importan en ese componente.

## 8. Flujo de datos (editar → publicar)

```
PlantillasPanel (lista) ──fila──► router.push(/configuracion/plantillas/:id)
   │
TemplateEditor: getTemplateForEdit(id) → { template, variables, versions }
   │  estado inicial = versión draft de mayor número, o la publicada, o vacío
   ├─ GrapesEditor carga designJson/compiledBody ; VariablePalette usa variables
   ├─ "Guardar borrador" → saveDraft(id, { subject, designJson, compiledBody }) → refresca versions
   ├─ PreviewPanel: sampleData (auto de variable.example, editable) → previewVersion(id, draftVersionId, sampleData) → iframe srcDoc=html
   ├─ TestSendDialog: testSend(code, { to, sampleData }) (en dev llega a javier.rappaz@gmail.com)
   ├─ "Publicar" → publish(id, draftVersionId) → template.currentVersionId actualizado
   └─ VersionHistory: "Restaurar vN" → restore(id, versionId) → nuevo draft → recargar editor
```

## 9. Branding, roles, errores

- **BrandingPanel**: `getBrand()` al montar (si vacío, muestra defaults del backend); formulario con inputs tipados (color pickers para colores, texto para el resto); "Guardar" → `upsertBrand(payload)`. Cambios se reflejan en el siguiente render de correos (el backend invalida su caché de Brand al hacer PUT).
- **Roles**: `useAuthStore` provee el rol; si no es superadmin, las secciones "Plantillas"/"Branding" no se agregan a `SECTIONS`. Defensa en profundidad: el backend responde 403 igualmente.
- **Errores/estados**: cada servicio maneja loading/empty/error con los patrones existentes (toasts vía `lib/toast`, skeletons/spinners de `@/components/ui`). El preview muestra el `html` de fallback del motor si algo falla (el backend nunca lanza).

## 10. Verificación

Sin unit tests (convención del repo). Se verifica con:
1. `npm run build` en `app-pmy` (typecheck de `next build` + guard `check-no-stubs`) y `next lint` — en verde.
2. `npm run build` en `pmy-api` para el endpoint nuevo; y arranque de la API (`node dist/main.js`) sin errores de DI.
3. **Browser pane** (dev server `app-pmy` en :4000, API corriendo): navegar a Configuración → Plantillas, abrir una plantilla sembrada (p.ej. `route_dispatch`), verificar que el editor carga el MJML, insertar una variable, guardar borrador, previsualizar con datos de ejemplo (el iframe muestra HTML con variables sustituidas), enviar prueba, publicar, y restaurar una versión. Editar Branding y confirmar persistencia. Revisar consola/red sin errores.

## 11. Alcance

**En esta Fase 2:** endpoint `GET :id/edit` (backend); sección Plantillas (lista + crear + editor GrapesJS + paleta de variables + historial/restore + preview de borrador + test-send + publicar); sección Branding (editor del Brand global); capa de servicios + tipos; integración GrapesJS/MJML client-only.

**Fuera (fases/decisiones posteriores):** CRUD de variables por UI; editores/previews para PDF y Excel (cuando existan esos renderers); i18n de la UI y selección de idioma; multi-tenant en la UI.

## 12. Criterios de aceptación

1. Un superadmin ve las secciones **Plantillas** y **Branding** en Configuración; otros roles no.
2. La lista muestra las plantillas (código, nombre, tipo, activa) y permite crear una nueva.
3. Abrir una plantilla carga el editor GrapesJS con su MJML/designJson; se puede insertar `{{variables}}` desde la paleta.
4. Guardar borrador persiste `subject`+`designJson`+`compiledBody`; el historial lista las versiones.
5. La vista previa renderiza (server) el **borrador** con datos de ejemplo autollenados y editables, mostrando el HTML resultante.
6. "Enviar prueba" envía el correo (en dev, redirigido a `javier.rappaz@gmail.com`).
7. Publicar deja la versión como la activa (`currentVersionId`); restaurar una versión previa crea un nuevo borrador editable.
8. El editor de Branding lee y guarda el Brand global.
9. `npm run build` + `next lint` (app-pmy) y `npm run build` (pmy-api) en verde; sin stubs.

## 13. Preguntas abiertas

- El tipo de documento al crear queda fijo en `email` en la UI de Fase 2 (PDF/Excel no tienen renderer aún). *Asumido.*
- El logo se captura como **URL** (no subida de archivo) en Fase 2; la subida de imágenes puede agregarse después. *Asumido.*
