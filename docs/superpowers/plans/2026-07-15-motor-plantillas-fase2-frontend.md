# Motor de Plantillas — Fase 2 Frontend (Plantillas + Branding, GrapesJS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la UI de administración de plantillas de correo (lista, editor visual GrapesJS, versionado/restore, preview y test-send) y el editor de Branding global en `app-pmy`, más el único endpoint de backend que el editor necesita en `pmy-api`.

**Architecture:** Sección "Plantillas" y "Branding" dentro de `app/configuracion` (solo superadmin); la lista vive en un panel, el editor GrapesJS en una ruta full-page `app/configuracion/plantillas/[id]`. Una capa de servicios (`lib/services/document-templates.ts`) habla con los endpoints existentes de `pmy-api` (más un nuevo `GET :id/edit`). GrapesJS + `grapesjs-mjml` se cargan client-only (dynamic import `ssr:false`); el cuerpo se guarda como MJML (`compiledBody`) + `designJson`.

**Tech Stack:** Next 16 (app router) + React 19 + TypeScript; shadcn-style UI (`@/components/ui/*`); `axiosConfig`; zustand (`useAuthStore`); `grapesjs` + `grapesjs-mjml`; NestJS (backend endpoint).

## Global Constraints

- **Dos repos:** backend en `D:\PMY\pmy-api` (branch `feat/template-engine-phase2`, ya creado); frontend en `D:\PMY\app-pmy` (crear branch `feat/template-engine-frontend` en la Task 2, antes del primer cambio de frontend).
- **Frontend sin unit tests** (convención del repo). Verificación por tarea = `npm run build` en `app-pmy` (corre `next build` con typecheck + el guard `check-no-stubs`) y, para UI visible, verificación con el Browser pane. **`check-no-stubs` PROHÍBE dejar stubs/TODOs/`throw new Error("not implemented")`** — todo debe quedar funcional.
- **Backend con unit tests** (Jest, repos mock, `new Service(mock)`), como en Fase 1.
- **API base:** `axiosConfig` (de `@/lib/axios-config`) ya apunta al `/api`; los servicios llaman rutas relativas SIN prefijo (`axiosConfig.get('documents/templates')`), igual que `lib/services/company-settings.ts`.
- **Auth/rol:** `useAuthStore().user?.role`; roles superadmin = `['superadmin','superamin']` (minúsculas). Gating de ruta con el HOC `withAuth` (`@/hoc/withAuth`): `withAuth(Component, ['superadmin'])` (superadmin siempre pasa).
- **Estilo UI:** copiar el patrón de un panel existente (`components/configuracion/company-panel.tsx`) para tarjetas/formularios; iconos `lucide-react`; util `cn` de `@/lib/utils`; toasts vía `@/lib/toast`.
- **OperationHeader:** en la ruta full-page del editor se usa NO-inline (publica en el header global); las acciones (Guardar/Publicar) van en su prop `actions`.
- **Endpoints backend existentes** (bajo `SuperAdminGuard`, prefijo `api`): `GET documents/templates`, `GET documents/templates/:code`, `POST documents/templates`, `POST documents/templates/:id/draft`, `POST documents/templates/:id/publish` `{versionId}`, `POST documents/templates/:id/restore` `{fromVersionId}`, `GET documents/templates/:id/versions`, `POST documents/templates/:code/preview` `{sampleData}`, `POST documents/templates/:id/versions/:versionId/preview` `{sampleData}`, `POST documents/templates/:code/test-send` `{to,sampleData}`, `GET documents/brand`, `PUT documents/brand`.
- Al terminar en cada repo, ejecutar `graphify update .`.

---

## Task 1: Backend — endpoint `GET documents/templates/:id/edit` (pmy-api)

**Files:**
- Modify: `src/documents/admin/template-admin.service.ts`
- Modify: `src/documents/admin/templates.controller.ts`
- Modify: `src/documents/admin/template-admin.service.spec.ts`

**Interfaces:**
- Consumes: repos `DocumentTemplate`, `DocumentTemplateVersion`, `TemplateVariableDef` (ya inyectados o disponibles); métodos `require(id)`, `listVersions(id)` existentes.
- Produces: `TemplateAdminService.getForEdit(id): Promise<{ template: DocumentTemplate; variables: TemplateVariableDef[]; versions: DocumentTemplateVersion[] }>`; ruta `GET documents/templates/:id/edit`.

> Nota: `TemplateAdminService` hoy inyecta `tplRepo`, `verRepo`, `brandRepo`, `store`, `branding`. NO inyecta `TemplateVariableDef`. Añade `@InjectRepository(TemplateVariableDef) private readonly varRepo: Repository<TemplateVariableDef>` al constructor (y su import). Actualiza el `make()` del spec para pasar un mock `varRepo`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/documents/admin/template-admin.service.spec.ts`. Primero, en el `make()` existente, agregar un `varRepo` mock y pasarlo al constructor en la posición correcta (segundo repo, tras `verRepo`... revisar el orden real del constructor y ubicarlo donde quede `varRepo`):

```ts
// dentro de make(): agregar
const vars: any[] = [{ id: 'v1def', templateId: 't1', name: 'tracking', label: 'Tracking', dataType: 'string', required: true }];
const varRepo: any = { find: ({ where }: any) => Promise.resolve(vars.filter((v) => v.templateId === where.templateId)) };
// pasar varRepo al `new TemplateAdminService(...)` en el orden del constructor actualizado
```

Nuevo test:

```ts
describe('getForEdit', () => {
  it('devuelve template + variables + versiones', async () => {
    const { svc } = make(); // 't1' existe en templates
    const res = await svc.getForEdit('t1');
    expect(res.template.id).toBe('t1');
    expect(Array.isArray(res.variables)).toBe(true);
    expect(res.variables[0].name).toBe('tracking');
    expect(Array.isArray(res.versions)).toBe(true);
  });

  it('lanza NotFound si la plantilla no existe', async () => {
    const { svc } = make();
    await expect(svc.getForEdit('nope')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- template-admin`
Expected: FAIL (`getForEdit` no existe / arity del constructor).

- [ ] **Step 3: Implementar `getForEdit` + inyectar varRepo**

En `template-admin.service.ts`, añadir el import y el parámetro de constructor:

```ts
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
// ...en el constructor, junto a los otros @InjectRepository:
@InjectRepository(TemplateVariableDef) private readonly varRepo: Repository<TemplateVariableDef>,
```

Añadir el método:

```ts
async getForEdit(id: string) {
  const template = await this.require(id); // lanza NotFoundException si no existe
  const [variables, versions] = await Promise.all([
    this.varRepo.find({ where: { templateId: id } }),
    this.listVersions(id),
  ]);
  return { template, variables, versions };
}
```

- [ ] **Step 4: Añadir la ruta al controller**

En `templates.controller.ts` (clase ya con `@UseGuards(SuperAdminGuard)`), añadir:

```ts
@Get(':id/edit')
getForEdit(@Param('id') id: string) {
  return this.admin.getForEdit(id);
}
```

> Verificar que `:id/edit` no colisione con `:code` (GET). En NestJS las rutas más específicas (`:id/edit` tiene 2 segmentos) no chocan con `:code` (1 segmento). OK.

- [ ] **Step 5: Correr tests + build**

Run: `npm test -- template-admin && npm run build`
Expected: PASS (tests nuevos + existentes); build OK.

- [ ] **Step 6: Commit**

```bash
git add src/documents/admin/template-admin.service.ts src/documents/admin/templates.controller.ts src/documents/admin/template-admin.service.spec.ts
git commit -m "feat(documents): endpoint GET templates/:id/edit (template+variables+versiones)"
```

---

## Task 2: Frontend — branch + capa de servicios + tipos (app-pmy)

**Files:**
- Create: `lib/services/document-templates.ts` (en `D:\PMY\app-pmy`)

**Interfaces:**
- Produces: tipos `DocumentFormat`, `VersionStatus`, `DocumentTemplate`, `DocumentTemplateVersion`, `TemplateVariableDef`, `Brand`, `RenderResult`, `TemplateForEdit`; y las funciones de servicio (firmas abajo). Todas las tareas de frontend consumen esto.

- [ ] **Step 1: Crear el branch de frontend**

En `D:\PMY\app-pmy`:

```bash
git checkout -b feat/template-engine-frontend
git branch --show-current   # feat/template-engine-frontend
```

- [ ] **Step 2: Crear el servicio + tipos**

```ts
// lib/services/document-templates.ts
import { axiosConfig } from "../axios-config";

export type DocumentFormat = 'email' | 'pdf' | 'excel' | 'report' | 'letter' | 'receipt' | 'label' | 'statement';
export type VersionStatus = 'draft' | 'published' | 'archived';

export interface DocumentTemplate {
  id: string; code: string; name: string; type: DocumentFormat;
  description?: string | null; language: string; active: boolean;
  category?: string | null; currentVersionId?: string | null;
}
export interface DocumentTemplateVersion {
  id: string; templateId: string; version: number; status: VersionStatus;
  subject?: string | null; designJson?: any; compiledBody?: string | null;
  changelog?: string | null; createdByName?: string | null; createdAt: string; publishedAt?: string | null;
}
export interface TemplateVariableDef {
  id: string; templateId: string; name: string; label: string;
  dataType: 'string' | 'number' | 'date' | 'currency' | 'boolean'; example?: string | null; required: boolean;
}
export interface Brand {
  id?: string; key?: string; logoLight?: string | null; logoDark?: string | null;
  colors?: Record<string, string> | null; typography?: Record<string, string> | null;
  borderRadius?: string | null; spacing?: Record<string, string> | null;
  fiscal?: Record<string, string> | null; contact?: Record<string, string> | null; social?: Record<string, string> | null;
}
export interface RenderResult { format: string; mime: string; subject?: string; html?: string; }
export interface TemplateForEdit { template: DocumentTemplate; variables: TemplateVariableDef[]; versions: DocumentTemplateVersion[]; }

export const listTemplates = async () =>
  (await axiosConfig.get<DocumentTemplate[]>("documents/templates")).data;

export const getTemplateForEdit = async (id: string) =>
  (await axiosConfig.get<TemplateForEdit>(`documents/templates/${id}/edit`)).data;

export const createTemplate = async (dto: { code: string; name: string; type: DocumentFormat; description?: string }) =>
  (await axiosConfig.post<DocumentTemplate>("documents/templates", dto)).data;

export const saveDraft = async (id: string, dto: { subject?: string; designJson?: any; compiledBody?: string; changelog?: string }) =>
  (await axiosConfig.post<DocumentTemplateVersion>(`documents/templates/${id}/draft`, dto)).data;

export const publishVersion = async (id: string, versionId: string) =>
  (await axiosConfig.post<DocumentTemplate>(`documents/templates/${id}/publish`, { versionId })).data;

export const restoreVersion = async (id: string, fromVersionId: string) =>
  (await axiosConfig.post<DocumentTemplateVersion>(`documents/templates/${id}/restore`, { fromVersionId })).data;

export const listVersions = async (id: string) =>
  (await axiosConfig.get<DocumentTemplateVersion[]>(`documents/templates/${id}/versions`)).data;

export const previewVersion = async (id: string, versionId: string, sampleData: Record<string, any>) =>
  (await axiosConfig.post<RenderResult>(`documents/templates/${id}/versions/${versionId}/preview`, { sampleData })).data;

export const previewPublished = async (code: string, sampleData: Record<string, any>) =>
  (await axiosConfig.post<RenderResult>(`documents/templates/${code}/preview`, { sampleData })).data;

export const testSend = async (code: string, payload: { to: string; sampleData?: Record<string, any> }) =>
  (await axiosConfig.post<{ ok: boolean }>(`documents/templates/${code}/test-send`, payload)).data;

export const getBrand = async () =>
  (await axiosConfig.get<Brand>("documents/brand")).data;

export const upsertBrand = async (payload: Partial<Brand>) =>
  (await axiosConfig.put<Brand>("documents/brand", payload)).data;
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run build`
Expected: `next build` compila sin errores de tipos (el archivo aún no se usa, pero debe tipar).

> Si `next build` es lento/pesado en el entorno, alternativamente `npx tsc --noEmit` para typecheck rápido de este archivo.

- [ ] **Step 4: Commit**

```bash
git add lib/services/document-templates.ts
git commit -m "feat(plantillas): capa de servicios + tipos del motor de plantillas"
```

---

## Task 3: Frontend — GrapesJS deps + componente GrapesEditor (app-pmy)

**Files:**
- Modify: `package.json` (deps)
- Create: `components/configuracion/plantillas/grapes-editor.tsx`

**Interfaces:**
- Produces: `GrapesEditor` (default export, client-only) con props:
  ```ts
  interface GrapesEditorProps {
    initialMjml?: string | null;
    initialDesign?: any | null;
    onReady?: (api: GrapesEditorApi) => void;   // expone insertVariable + getContent
  }
  interface GrapesEditorApi {
    insertVariable: (name: string) => void;      // inserta `{{name}}`
    getContent: () => { mjml: string; designJson: any };
  }
  ```
- Consumes: nada de tareas previas.

- [ ] **Step 1: Instalar dependencias**

En `D:\PMY\app-pmy`:

Run: `npm install grapesjs grapesjs-mjml`
Expected: se agregan a `dependencies`.

- [ ] **Step 2: Implementar el componente client**

```tsx
// components/configuracion/plantillas/grapes-editor.tsx
"use client";

import { useEffect, useRef } from "react";
import grapesjs, { Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";
import "grapesjs/dist/css/grapes.min.css";

export interface GrapesEditorApi {
  insertVariable: (name: string) => void;
  getContent: () => { mjml: string; designJson: any };
}

interface GrapesEditorProps {
  initialMjml?: string | null;
  initialDesign?: any | null;
  onReady?: (api: GrapesEditorApi) => void;
}

const DEFAULT_MJML = `<mjml><mj-body><mj-section><mj-column><mj-text>Escribe tu contenido…</mj-text></mj-column></mj-section></mj-body></mjml>`;

export default function GrapesEditor({ initialMjml, initialDesign, onReady }: GrapesEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      fromElement: false,
      storageManager: false,
      plugins: [grapesjsMjml as any],
      pluginsOpts: { [grapesjsMjml as any]: {} },
    });
    editorRef.current = editor;

    // Carga inicial: preferir designJson; si no, cargar desde MJML.
    editor.on("load", () => {
      try {
        if (initialDesign) editor.loadProjectData(initialDesign);
        else editor.setComponents(initialMjml || DEFAULT_MJML);
      } catch {
        editor.setComponents(initialMjml || DEFAULT_MJML);
      }

      const api: GrapesEditorApi = {
        insertVariable: (name: string) => {
          const token = `{{${name}}}`;
          const selected = editor.getSelected();
          // Inserta el token en el componente seleccionado o al final del cuerpo.
          if (selected) selected.append(token);
          else editor.getWrapper()?.append(token);
        },
        // getHtml() bajo el preset grapesjs-mjml devuelve el MJML fuente.
        getContent: () => ({ mjml: editor.getHtml(), designJson: editor.getProjectData() }),
      };
      onReady?.(api);
    });

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="h-full min-h-[500px] w-full" ref={containerRef} />;
}
```

> **VERIFICACIÓN CRÍTICA en el navegador (Step 4):** confirmar que, bajo `grapesjs-mjml`, `editor.getHtml()` devuelve **MJML** (string que empieza con `<mjml`) y NO HTML compilado. Si esta versión del preset compila a HTML en `getHtml()`, usar el comando de exportación MJML del preset (p.ej. `editor.runCommand('mjml-code-str')` o `getMjml()` según la versión) y ajustar `getContent().mjml`. El motor backend detecta el cuerpo por `<mjml`, así que `compiledBody` DEBE ser MJML.

- [ ] **Step 3: Consumidor client-only (dynamic import)**

Este componente se importará SIEMPRE con `next/dynamic` `{ ssr: false }` desde quien lo use (Task 5). No se importa directo en un Server Component. (No hay código que escribir aquí; es una nota para las tareas siguientes.)

- [ ] **Step 4: Verificar (build + navegador)**

Run: `npm run build`
Expected: compila. (Nota: GrapesJS solo corre en cliente; el build no lo ejecuta.)

Verificación en navegador se hará al integrarlo (Task 5), pero si quieres validar aislado, monta temporalmente el editor en una página de prueba y confirma que renderiza el lienzo y que `getContent().mjml` empieza con `<mjml`. Elimina cualquier página de prueba antes de commitear (el guard `check-no-stubs`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components/configuracion/plantillas/grapes-editor.tsx
git commit -m "feat(plantillas): componente GrapesEditor (GrapesJS + grapesjs-mjml, client-only)"
```

---

## Task 4: Frontend — Sección Plantillas: lista + crear (app-pmy)

**Files:**
- Create: `components/configuracion/plantillas/create-template-dialog.tsx`
- Create: `components/configuracion/plantillas/plantillas-panel.tsx`
- Modify: `app/configuracion/page.tsx`

**Interfaces:**
- Consumes: `listTemplates`, `createTemplate` (Task 2).
- Produces: `PlantillasPanel` (default o named export usado por la página); sección `plantillas` visible solo a superadmin.

- [ ] **Step 1: CreateTemplateDialog**

```tsx
// components/configuracion/plantillas/create-template-dialog.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTemplate } from "@/lib/services/document-templates";
import { toast } from "@/lib/toast";
import { Plus } from "lucide-react";

export function CreateTemplateDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", description: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error?.("Código y nombre son obligatorios"); return; }
    setSaving(true);
    try {
      const t = await createTemplate({ code: form.code.trim(), name: form.name.trim(), type: "email", description: form.description || undefined });
      toast.success?.("Plantilla creada");
      setOpen(false);
      onCreated(t.id);
    } catch (e: any) {
      toast.error?.(e?.response?.data?.message || "No se pudo crear la plantilla");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nueva plantilla</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nueva plantilla de correo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Código interno</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="p.ej. welcome_email" /></div>
          <div className="space-y-1"><Label>Nombre</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Correo de bienvenida" /></div>
          <div className="space-y-1"><Label>Descripción (opcional)</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Creando…" : "Crear"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: PlantillasPanel (lista)**

```tsx
// components/configuracion/plantillas/plantillas-panel.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listTemplates, DocumentTemplate } from "@/lib/services/document-templates";
import { CreateTemplateDialog } from "./create-template-dialog";
import { toast } from "@/lib/toast";

export function PlantillasPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<DocumentTemplate[] | null>(null);

  const load = async () => {
    try { setRows(await listTemplates()); }
    catch { toast.error?.("No se pudieron cargar las plantillas"); setRows([]); }
  };
  useEffect(() => { void load(); }, []);

  const openEditor = (id: string) => router.push(`/configuracion/plantillas/${id}`);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div><CardTitle>Plantillas</CardTitle><CardDescription>Correos configurables del sistema.</CardDescription></div>
        <CreateTemplateDialog onCreated={openEditor} />
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No hay plantillas. Crea la primera.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => openEditor(t.id)}>
                  <TableCell className="font-mono text-xs">{t.code}</TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell><Badge variant="secondary">{t.type}</Badge></TableCell>
                  <TableCell>{t.active ? <Badge>Activa</Badge> : <Badge variant="outline">Inactiva</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Registrar la sección en configuracion/page.tsx (solo superadmin)**

En `app/configuracion/page.tsx`:
- Importar: `import { PlantillasPanel } from "@/components/configuracion/plantillas/plantillas-panel";`, `import { useAuthStore } from "@/store/auth.store";`, y el icono `Mail` de lucide.
- Dentro del componente, calcular el rol y filtrar las secciones superadmin:

```tsx
const role = (useAuthStore((s) => s.user?.role) || "").toString().toLowerCase();
const isSuper = ["superadmin", "superamin"].includes(role);
```

- Añadir la entrada a `SECTIONS` (después de "whatsapp"): `{ id: "plantillas", label: "Plantillas", icon: Mail, description: "Correos configurables" },`
- Filtrar el render del nav para ocultar `plantillas` (y luego `branding`) si `!isSuper`. La forma mínima: derivar `const sections = SECTIONS.filter((s) => (s.id === "plantillas" || s.id === "branding") ? isSuper : true);` y mapear `sections` en el `<nav>` y en el `<Select>` móvil en vez de `SECTIONS`.
- Añadir el render del panel: `{section === "plantillas" && <PlantillasPanel />}`.

- [ ] **Step 4: Verificar (build + navegador)**

Run: `npm run build`
Expected: compila.

Browser (con API corriendo + login superadmin): Configuración → sección "Plantillas" visible; la tabla lista las 12 plantillas sembradas; "Nueva plantilla" abre el dialog. (Verificación visual detallada en Task 9; aquí basta build + que la sección aparezca.)

- [ ] **Step 5: Commit**

```bash
git add components/configuracion/plantillas/ app/configuracion/page.tsx
git commit -m "feat(plantillas): sección lista + crear plantilla en Configuración (solo superadmin)"
```

---

## Task 5: Frontend — Editor: ruta, carga, GrapesJS + paleta + subject + guardar/publicar (app-pmy)

**Files:**
- Create: `components/configuracion/plantillas/variable-palette.tsx`
- Create: `components/configuracion/plantillas/template-editor.tsx`
- Create: `app/configuracion/plantillas/[id]/page.tsx`

**Interfaces:**
- Consumes: `getTemplateForEdit`, `saveDraft`, `publishVersion` (Task 2); `GrapesEditor`/`GrapesEditorApi` (Task 3).
- Produces: la experiencia de edición. `TemplateEditor` recibe `{ templateId: string }`.

- [ ] **Step 1: VariablePalette**

```tsx
// components/configuracion/plantillas/variable-palette.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy } from "lucide-react";
import { toast } from "@/lib/toast";
import { TemplateVariableDef } from "@/lib/services/document-templates";

export function VariablePalette({ variables, onInsert }: { variables: TemplateVariableDef[]; onInsert: (name: string) => void }) {
  const copy = (name: string) => { void navigator.clipboard?.writeText(`{{${name}}}`); toast.message?.(`Copiado {{${name}}}`); };
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Variables disponibles</p>
      {variables.length === 0 && <p className="text-xs text-muted-foreground">Sin variables declaradas.</p>}
      <div className="flex flex-col gap-1">
        {variables.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-md border px-2 py-1.5">
            <button className="min-w-0 text-left" onClick={() => onInsert(v.name)} title="Insertar en el editor">
              <span className="block truncate text-sm">{v.label}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{`{{${v.name}}}`}{v.required ? " *" : ""}</span>
            </button>
            <Button variant="ghost" size="icon" onClick={() => copy(v.name)}><Copy className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TemplateEditor (orquesta carga, edición, guardar, publicar)**

```tsx
// components/configuracion/plantillas/template-editor.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { OperationHeader } from "@/components/shared/operation-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Save, Send } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  getTemplateForEdit, saveDraft, publishVersion,
  TemplateForEdit, DocumentTemplateVersion,
} from "@/lib/services/document-templates";
import { VariablePalette } from "./variable-palette";
import type { GrapesEditorApi } from "./grapes-editor";

const GrapesEditor = dynamic(() => import("./grapes-editor"), { ssr: false });

function pickWorkingVersion(data: TemplateForEdit): DocumentTemplateVersion | null {
  const drafts = data.versions.filter((v) => v.status === "draft").sort((a, b) => b.version - a.version);
  if (drafts[0]) return drafts[0];
  const pub = data.versions.find((v) => v.id === data.template.currentVersionId);
  return pub || data.versions.sort((a, b) => b.version - a.version)[0] || null;
}

export function TemplateEditor({ templateId }: { templateId: string }) {
  const [data, setData] = useState<TemplateForEdit | null>(null);
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const apiRef = useRef<GrapesEditorApi | null>(null);

  const reload = async () => {
    const d = await getTemplateForEdit(templateId);
    setData(d);
    const wv = pickWorkingVersion(d);
    setSubject(wv?.subject || "");
    setDraftVersionId(wv && wv.status === "draft" ? wv.id : null);
    return d;
  };
  useEffect(() => { reload().catch(() => toast.error?.("No se pudo cargar la plantilla")); /* eslint-disable-next-line */ }, [templateId]);

  const onSave = async () => {
    if (!apiRef.current) return;
    setSaving(true);
    try {
      const { mjml, designJson } = apiRef.current.getContent();
      const v = await saveDraft(templateId, { subject, compiledBody: mjml, designJson });
      setDraftVersionId(v.id);
      toast.success?.("Borrador guardado");
      await reload();
    } catch { toast.error?.("No se pudo guardar"); }
    finally { setSaving(false); }
  };

  const onPublish = async () => {
    let vId = draftVersionId;
    if (!vId) { await onSave(); vId = draftVersionId; }
    if (!vId) return;
    try { await publishVersion(templateId, vId); toast.success?.("Plantilla publicada"); await reload(); }
    catch { toast.error?.("No se pudo publicar"); }
  };

  const working = data ? pickWorkingVersion(data) : null;

  return (
    <div className="space-y-4">
      <OperationHeader
        icon={Mail}
        title={data ? `Editar: ${data.template.name}` : "Editar plantilla"}
        description={data?.template.code}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onSave} disabled={saving}><Save className="h-4 w-4 mr-1" /> Guardar</Button>
            <Button size="sm" onClick={onPublish} disabled={saving}><Send className="h-4 w-4 mr-1" /> Publicar</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Asunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto (admite {{variables}})" />
          </div>
          <Card><CardContent className="p-0 h-[600px]">
            {data && (
              <GrapesEditor
                initialMjml={working?.compiledBody}
                initialDesign={working?.designJson}
                onReady={(api) => { apiRef.current = api; }}
              />
            )}
          </CardContent></Card>
        </div>
        <div className="space-y-4">
          <VariablePalette variables={data?.variables || []} onInsert={(n) => apiRef.current?.insertVariable(n)} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Ruta full-page**

```tsx
// app/configuracion/plantillas/[id]/page.tsx
"use client";

import { use } from "react";
import { AppLayout } from "@/components/app-layout";
import { withAuth } from "@/hoc/withAuth";
import { TemplateEditor } from "@/components/configuracion/plantillas/template-editor";

function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppLayout>
      <TemplateEditor templateId={id} />
    </AppLayout>
  );
}

export default withAuth(TemplateEditorPage, ["superadmin"]);
```

> Nota Next 16: `params` es una Promise en páginas cliente; se desenvuelve con `React.use(params)`. Confirmar el patrón contra otra ruta `[id]` existente del repo (p.ej. una en `app/`); si el repo usa otra forma, seguirla.

- [ ] **Step 4: Verificar (build + navegador)**

Run: `npm run build`
Expected: compila.

Browser (API + login superadmin): abrir una plantilla desde la lista → carga el editor con su MJML; insertar una variable desde la paleta la agrega como `{{name}}`; "Guardar" crea/actualiza el borrador (toast ok); revisar Network: `POST documents/templates/:id/draft` responde 201/200. **Aquí también validar el punto crítico de Task 3**: que `compiledBody` enviado empiece con `<mjml` (revisar el payload en Network); si no, ajustar `getContent().mjml` en `grapes-editor.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/configuracion/plantillas/variable-palette.tsx components/configuracion/plantillas/template-editor.tsx "app/configuracion/plantillas/[id]/page.tsx"
git commit -m "feat(plantillas): editor GrapesJS con paleta de variables, asunto, guardar y publicar"
```

---

## Task 6: Frontend — Historial de versiones + restaurar (app-pmy)

**Files:**
- Create: `components/configuracion/plantillas/version-history.tsx`
- Modify: `components/configuracion/plantillas/template-editor.tsx`

**Interfaces:**
- Consumes: `restoreVersion` (Task 2); `data.versions` de `TemplateForEdit`.
- Produces: `VersionHistory` con `{ versions, currentVersionId, onRestore }`.

- [ ] **Step 1: VersionHistory**

```tsx
// components/configuracion/plantillas/version-history.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw } from "lucide-react";
import { DocumentTemplateVersion } from "@/lib/services/document-templates";

export function VersionHistory({
  versions, currentVersionId, onRestore,
}: { versions: DocumentTemplateVersion[]; currentVersionId?: string | null; onRestore: (versionId: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Historial de versiones</p>
      <div className="flex flex-col gap-1">
        {versions.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-md border px-2 py-1.5">
            <div className="min-w-0">
              <span className="text-sm">v{v.version} {v.id === currentVersionId && <Badge className="ml-1">Publicada</Badge>} {v.status === "draft" && <Badge variant="secondary" className="ml-1">Borrador</Badge>}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{new Date(v.createdAt).toLocaleString("es-MX")}{v.createdByName ? ` · ${v.createdByName}` : ""}</span>
            </div>
            <Button variant="ghost" size="icon" title="Restaurar" onClick={() => onRestore(v.id)}><RotateCcw className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrar en TemplateEditor**

En `template-editor.tsx`: importar `VersionHistory` y `restoreVersion`. Añadir el handler y renderizarlo en la columna derecha (debajo de `VariablePalette`):

```tsx
import { VersionHistory } from "./version-history";
import { restoreVersion } from "@/lib/services/document-templates";
// ...
const onRestore = async (versionId: string) => {
  try {
    const v = await restoreVersion(templateId, versionId);
    toast.success?.(`Restaurado como borrador v${v.version}`);
    await reload();
  } catch { toast.error?.("No se pudo restaurar"); }
};
// en la columna derecha, tras <VariablePalette .../>:
{data && <VersionHistory versions={data.versions} currentVersionId={data.template.currentVersionId} onRestore={onRestore} />}
```

> Tras restaurar, `reload()` recarga `getForEdit`; el nuevo borrador (mayor número) pasa a ser la versión de trabajo y el editor se re-monta con su contenido (el `key` del `GrapesEditor` no cambia por sí solo — para forzar recarga del lienzo, pasar `key={working?.id}` al `<GrapesEditor>` en `template-editor.tsx` para que React lo remonte cuando cambia la versión de trabajo). Añadir ese `key`.

- [ ] **Step 3: Verificar (build + navegador)**

Run: `npm run build`
Expected: compila.

Browser: el panel derecho muestra las versiones; "Restaurar" en una versión crea un borrador nuevo (toast) y el editor recarga su contenido.

- [ ] **Step 4: Commit**

```bash
git add components/configuracion/plantillas/version-history.tsx components/configuracion/plantillas/template-editor.tsx
git commit -m "feat(plantillas): historial de versiones + restaurar"
```

---

## Task 7: Frontend — Vista previa + enviar prueba (app-pmy)

**Files:**
- Create: `components/configuracion/plantillas/preview-panel.tsx`
- Create: `components/configuracion/plantillas/test-send-dialog.tsx`
- Modify: `components/configuracion/plantillas/template-editor.tsx`

**Interfaces:**
- Consumes: `previewVersion`, `testSend` (Task 2); `data.variables`, el `code`, y el `draftVersionId` del editor.
- Produces: `PreviewPanel` y `TestSendDialog`. Ambos reciben `sampleData` (estado compartido, autollenado desde `variable.example`).

- [ ] **Step 1: Helper de sampleData inicial**

En `template-editor.tsx`, derivar el sampleData inicial desde las variables:

```ts
function initialSample(vars: { name: string; example?: string | null }[]): Record<string, any> {
  const o: Record<string, any> = {};
  for (const v of vars) o[v.name] = v.example ?? "";
  return o;
}
```

Estado en el editor: `const [sample, setSample] = useState<Record<string, any>>({});` y setearlo en `reload()` con `setSample(initialSample(d.variables));`.

- [ ] **Step 2: PreviewPanel**

```tsx
// components/configuracion/plantillas/preview-panel.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye } from "lucide-react";
import { previewVersion, TemplateVariableDef } from "@/lib/services/document-templates";
import { toast } from "@/lib/toast";

export function PreviewPanel({
  templateId, versionId, variables, sample, onSampleChange,
}: {
  templateId: string; versionId: string | null; variables: TemplateVariableDef[];
  sample: Record<string, any>; onSampleChange: (s: Record<string, any>) => void;
}) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!versionId) { toast.error?.("Guarda un borrador primero"); return; }
    setLoading(true);
    try { const r = await previewVersion(templateId, versionId, sample); setHtml(r.html || ""); }
    catch { toast.error?.("No se pudo previsualizar"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {variables.map((v) => (
          <div key={v.id} className="space-y-1">
            <Label className="text-xs">{v.label} <span className="font-mono text-muted-foreground">{`{{${v.name}}}`}</span></Label>
            <Input value={sample[v.name] ?? ""} onChange={(e) => onSampleChange({ ...sample, [v.name]: e.target.value })} />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={run} disabled={loading}><Eye className="h-4 w-4 mr-1" /> {loading ? "Generando…" : "Vista previa"}</Button>
      {html && (
        <iframe title="preview" className="w-full h-[500px] rounded-md border bg-white" srcDoc={html} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: TestSendDialog**

```tsx
// components/configuracion/plantillas/test-send-dialog.tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send } from "lucide-react";
import { testSend } from "@/lib/services/document-templates";
import { toast } from "@/lib/toast";

export function TestSendDialog({ code, sample }: { code: string; sample: Record<string, any> }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!to.trim()) { toast.error?.("Escribe un destinatario"); return; }
    setSending(true);
    try { await testSend(code, { to: to.trim(), sampleData: sample }); toast.success?.("Correo de prueba enviado"); setOpen(false); }
    catch { toast.error?.("No se pudo enviar la prueba"); }
    finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Send className="h-4 w-4 mr-1" /> Enviar prueba</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Enviar correo de prueba</DialogTitle></DialogHeader>
        <div className="space-y-1">
          <Label>Destinatario</Label>
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="correo@ejemplo.com" />
          <p className="text-[11px] text-muted-foreground">En ambiente de desarrollo el correo se redirige a la bandeja de sistemas.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={send} disabled={sending}>{sending ? "Enviando…" : "Enviar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Integrar en TemplateEditor (tabs Editor / Vista previa)**

En `template-editor.tsx`: importar `Tabs, TabsList, TabsTrigger, TabsContent` de `@/components/ui/tabs`, `PreviewPanel`, `TestSendDialog`. Añadir `TestSendDialog` al bloque de `actions` del `OperationHeader` (junto a Guardar/Publicar), pasando `code={data.template.code}` y `sample`. Envolver el área principal (editor) en Tabs con dos pestañas: "Editor" (el GrapesEditor + subject actuales) y "Vista previa" (`<PreviewPanel templateId={templateId} versionId={draftVersionId} variables={data.variables} sample={sample} onSampleChange={setSample} />`). Mantener la columna derecha (paleta + historial) visible en ambas o solo en Editor, a criterio.

- [ ] **Step 5: Verificar (build + navegador)**

Run: `npm run build`
Expected: compila.

Browser: en "Vista previa", editar un dato de ejemplo y pulsar "Vista previa" → el iframe muestra el HTML con las variables sustituidas (Network: `POST :id/versions/:versionId/preview` 200). "Enviar prueba" con un correo → toast ok (Network 201).

- [ ] **Step 6: Commit**

```bash
git add components/configuracion/plantillas/preview-panel.tsx components/configuracion/plantillas/test-send-dialog.tsx components/configuracion/plantillas/template-editor.tsx
git commit -m "feat(plantillas): vista previa server-side + enviar correo de prueba"
```

---

## Task 8: Frontend — Editor de Branding global (app-pmy)

**Files:**
- Create: `components/configuracion/branding-panel.tsx`
- Modify: `app/configuracion/page.tsx`

**Interfaces:**
- Consumes: `getBrand`, `upsertBrand`, `Brand` (Task 2).
- Produces: `BrandingPanel`; sección `branding` (solo superadmin).

- [ ] **Step 1: BrandingPanel**

```tsx
// components/configuracion/branding-panel.tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getBrand, upsertBrand, Brand } from "@/lib/services/document-templates";
import { toast } from "@/lib/toast";

const COLOR_KEYS = ["primary", "secondary", "button", "text", "background"] as const;

export function BrandingPanel() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getBrand().then(setBrand).catch(() => { toast.error?.("No se pudo cargar el branding"); setBrand({}); }); }, []);

  const setColor = (k: string, val: string) => setBrand((b) => ({ ...(b || {}), colors: { ...(b?.colors || {}), [k]: val } }));
  const setField = (group: keyof Brand, k: string, val: string) =>
    setBrand((b) => ({ ...(b || {}), [group]: { ...((b?.[group] as any) || {}), [k]: val } }));

  const save = async () => {
    if (!brand) return;
    setSaving(true);
    try { setBrand(await upsertBrand(brand)); toast.success?.("Branding guardado"); }
    catch { toast.error?.("No se pudo guardar"); }
    finally { setSaving(false); }
  };

  if (!brand) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Logos</CardTitle><CardDescription>URLs de los logotipos.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Logo claro (URL)</Label><Input value={brand.logoLight || ""} onChange={(e) => setBrand({ ...brand, logoLight: e.target.value })} /></div>
          <div className="space-y-1"><Label>Logo oscuro (URL)</Label><Input value={brand.logoDark || ""} onChange={(e) => setBrand({ ...brand, logoDark: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Colores</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {COLOR_KEYS.map((k) => (
            <div key={k} className="space-y-1">
              <Label className="capitalize">{k}</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={brand.colors?.[k] || "#000000"} onChange={(e) => setColor(k, e.target.value)} className="h-9 w-10 rounded border" />
                <Input value={brand.colors?.[k] || ""} onChange={(e) => setColor(k, e.target.value)} className="font-mono text-xs" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tipografía y bordes</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Fuente</Label><Input value={brand.typography?.fontFamily || ""} onChange={(e) => setField("typography", "fontFamily", e.target.value)} placeholder="Arial, sans-serif" /></div>
          <div className="space-y-1"><Label>Tamaño base</Label><Input value={brand.typography?.baseSize || ""} onChange={(e) => setField("typography", "baseSize", e.target.value)} placeholder="14px" /></div>
          <div className="space-y-1"><Label>Radio de borde</Label><Input value={brand.borderRadius || ""} onChange={(e) => setBrand({ ...brand, borderRadius: e.target.value })} placeholder="8px" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Datos fiscales y contacto</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Razón social</Label><Input value={brand.fiscal?.razonSocial || ""} onChange={(e) => setField("fiscal", "razonSocial", e.target.value)} /></div>
          <div className="space-y-1"><Label>RFC</Label><Input value={brand.fiscal?.rfc || ""} onChange={(e) => setField("fiscal", "rfc", e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Dirección</Label><Input value={brand.fiscal?.direccion || ""} onChange={(e) => setField("fiscal", "direccion", e.target.value)} /></div>
          <div className="space-y-1"><Label>Teléfono</Label><Input value={brand.contact?.phone || ""} onChange={(e) => setField("contact", "phone", e.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input value={brand.contact?.email || ""} onChange={(e) => setField("contact", "email", e.target.value)} /></div>
          <div className="space-y-1"><Label>Sitio web</Label><Input value={brand.contact?.website || ""} onChange={(e) => setField("contact", "website", e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Redes sociales</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Facebook</Label><Input value={brand.social?.facebook || ""} onChange={(e) => setField("social", "facebook", e.target.value)} /></div>
          <div className="space-y-1"><Label>Instagram</Label><Input value={brand.social?.instagram || ""} onChange={(e) => setField("social", "instagram", e.target.value)} /></div>
          <div className="space-y-1"><Label>WhatsApp</Label><Input value={brand.social?.whatsapp || ""} onChange={(e) => setField("social", "whatsapp", e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar branding"}</Button></div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar la sección en configuracion/page.tsx**

- Importar `BrandingPanel` y el icono `Palette` de lucide.
- Añadir a `SECTIONS`: `{ id: "branding", label: "Branding", icon: Palette, description: "Identidad visual" },` (el filtro superadmin ya lo cubre por el `sections.filter` de la Task 4).
- Render: `{section === "branding" && <BrandingPanel />}`.

- [ ] **Step 3: Verificar (build + navegador)**

Run: `npm run build`
Expected: compila.

Browser: sección "Branding" visible (superadmin); carga los valores actuales; cambiar un color y "Guardar branding" → toast ok (Network `PUT documents/brand` 200); recargar confirma persistencia.

- [ ] **Step 4: Commit**

```bash
git add components/configuracion/branding-panel.tsx app/configuracion/page.tsx
git commit -m "feat(branding): editor de identidad visual global"
```

---

## Task 9: Verificación integral end-to-end (ambos repos)

**Files:** ninguno nuevo.

- [ ] **Step 1: Builds y lint**

- `pmy-api`: `npm run build` (OK) y `npm test -- template-admin` (verde).
- `app-pmy`: `npm run build` (incluye `check-no-stubs`) y `npx next lint` (sin errores nuevos).

- [ ] **Step 2: E2E en el navegador (Browser pane)**

Con la API `pmy-api` corriendo (migración aplicada + `npm run seed` para tener las 12 plantillas) y el dev server `app-pmy` (`npm run dev`, puerto 4000), autenticado como superadmin:
1. Configuración → **Plantillas**: la lista muestra las 12 plantillas. Rol NO superadmin: la sección no aparece.
2. Abrir `route_dispatch` → el editor carga su MJML; insertar `{{trackingNumber}}` desde la paleta; "Guardar" (borrador creado); confirmar en Network que `compiledBody` empieza con `<mjml`.
3. Pestaña **Vista previa**: editar datos de ejemplo → "Vista previa" muestra el HTML con variables sustituidas.
4. **Enviar prueba** a un correo → toast ok (en dev, llega a `javier.rappaz@gmail.com`).
5. **Publicar** → sin error; recargar la lista/edición refleja la versión publicada.
6. **Historial** → "Restaurar" una versión previa crea un borrador nuevo y el editor recarga.
7. **Branding**: editar un color + datos de contacto, guardar, recargar → persiste.
Revisar consola/red sin errores en todo el flujo. Capturar un screenshot del editor y del preview como evidencia.

- [ ] **Step 3: Refrescar grafos**

- En `pmy-api`: `graphify update .`
- En `app-pmy`: `graphify update .`

- [ ] **Step 4: Commit final (si quedaron cambios de lint/ajustes)**

```bash
# en cada repo, si hubo ajustes:
git add -A && git commit -m "chore(plantillas): verificación integral Fase 2 + ajustes"
```

---

## Self-Review (autor)

- **Cobertura del spec:** endpoint `:id/edit` §4 → T1; servicios §6 → T2; GrapesJS §7 → T3/T5; lista+crear §5 → T4; editor+paleta+subject+guardar/publicar §5/§8 → T5; historial/restore §8 → T6; preview+test-send §8 → T7; branding §9 → T8; roles §9 → T4/T5 (filtro SECTIONS + `withAuth(['superadmin'])`); verificación §10 → cada tarea + T9; criterios de aceptación §12 → T9.
- **Consistencia de tipos/nombres:** `getTemplateForEdit`/`TemplateForEdit`, `saveDraft`, `publishVersion`, `restoreVersion`, `previewVersion`, `testSend`, `getBrand`/`upsertBrand`, `GrapesEditorApi.{insertVariable,getContent}` — idénticos entre T2 y sus consumidores (T4–T8).
- **Riesgo conocido (documentado):** la API exacta de `grapesjs-mjml` para obtener MJML puede variar por versión; T3/T5 lo verifican en navegador y ajustan `getContent().mjml` — es el único punto que exige validación en vivo. `params` como Promise en Next 16 (T5) se confirma contra una ruta `[id]` existente.
- **Sin unit tests en frontend:** por convención del repo; se compensa con build/typecheck + `check-no-stubs` + verificación en navegador por tarea y E2E en T9.
