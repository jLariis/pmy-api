# Motor de Plantillas — Fase 4 Etapa A: Editor de correos con Unlayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el editor de bloques "plano" por el constructor visual **Unlayer (`react-email-editor`)** para correos — rich-text (negrita/itálica/subrayado/tamaños/colores/fondos), bloques drag-drop, lienzo en vivo, variables como merge tags, branding — guardando diseño + HTML; el backend renderiza el HTML de Unlayer con `{{variables}}` (Handlebars).

**Architecture:** `UnlayerEditor` (client-only) monta `<EmailEditor>`, carga el diseño Unlayer de la versión (o un diseño base si aún no hay uno), registra las variables como merge tags y aplica branding. Al guardar, exporta `{ design, html }` → `saveDraft({ subject, designJson: design, compiledBody: html })`. `EmailRenderer` (Fase 1) YA maneja HTML plano de Unlayer vía su rama de fallback (`designJson` sin `.blocks` → usa `compiledBody` → Handlebars → como no contiene `<mjml`, devuelve el HTML). El lienzo de Unlayer es el preview en vivo (se acabó el "guardar primero").

**Tech Stack:** Next 16 (app router, `output:'export'`), React 19, `react-email-editor` (Unlayer), shadcn UI; backend NestJS (verificación de `EmailRenderer`).

## Global Constraints

- **Dos repos:** frontend `D:\PMY\app-pmy` branch **`feat/template-engine-frontend`** (Tasks 1-2, 4); backend `D:\PMY\pmy-api` branch **`feat/template-engine-phase3`** (Task 3). NO mergear a main.
- Hook **graphify** en ambos: `graphify query "<pregunta>"` antes de leer/editar cualquier fuente.
- **Sin `projectId` de Unlayer** al inicio (diseño + export HTML funcionan sin cuenta; imágenes por URL). Anotar que un `projectId` habilitaría el asset manager.
- **Variables = merge tags de Unlayer**: cada `TemplateVariableDef` → `{ name: label, value: '{{name}}' }`, de modo que el HTML exportado contenga `{{name}}` literal (lo resuelve Handlebars al render).
- **Guardado:** `saveDraft(id, { subject, designJson: <unlayer design JSON>, compiledBody: <unlayer HTML> })`. `designJson` es el diseño Unlayer (para re-editar); `compiledBody` es el HTML (para render).
- **Compatibilidad legacy:** `EmailRenderer` debe seguir manejando (a) HTML de Unlayer en `compiledBody` y (b) el fallback de bloques (`designJson.blocks`) de Fase 3, sin romper. NO borrar el `BlockComposer`.
- El editor Unlayer es **client-only**: se consume con `next/dynamic { ssr:false }`. `output:'export'` no debe romper (todo en cliente).
- Frontend sin unit tests (convención): verificación = `npm run build` (+ `check-no-stubs`) + Browser pane. Backend: Jest.
- La **API exacta de `react-email-editor`** debe confirmarse contra la versión instalada (patrón habitual: `<EmailEditor ref={ref} onReady={(unlayer)=>…} options={{mergeTags, appearance}}/>`; `unlayer.loadDesign(design)`, `unlayer.exportHtml(cb => cb({design, html}))`, `unlayer.setMergeTags(tags)`). Verificar en navegador.

---

## Task 1: Dependencia + componente `UnlayerEditor`

**Files:**
- Modify: `package.json` (dep `react-email-editor`)
- Create: `components/configuracion/plantillas/unlayer/unlayer-editor.tsx`
- Create: `components/configuracion/plantillas/unlayer/base-design.ts`

**Interfaces:**
- Produces:
  - `BASE_DESIGN` — un diseño Unlayer mínimo branded (encabezado + área de texto + pie) para correos nuevos o legacy sin diseño Unlayer.
  - `UnlayerEditorApi = { exportDesign: () => Promise<{ design: any; html: string }> }`.
  - `UnlayerEditor` (default export, client-only) props: `{ initialDesign?: any | null; variables?: { name: string; label: string }[]; brand?: { primary?: string } | null; onReady?: (api: UnlayerEditorApi) => void }`.

- [ ] **Step 1: Instalar la dependencia**

Run (en D:\PMY\app-pmy): `npm install react-email-editor`
Expected: se agrega a `dependencies`.

- [ ] **Step 2: Crear el diseño base**

```ts
// components/configuracion/plantillas/unlayer/base-design.ts
/** Diseño Unlayer mínimo branded: encabezado + texto + pie. Para correos nuevos
 *  o los que aún no tienen diseño Unlayer (p.ej. sembrados como bloques en Fase 3). */
export const BASE_DESIGN: any = {
  body: {
    rows: [
      { cells: [1], columns: [{ contents: [
        { type: 'text', values: { text: '<h1 style="margin:0">Título</h1>' } },
        { type: 'text', values: { text: '<p>Escribe tu contenido aquí. Inserta variables desde "Merge Tags".</p>' } },
      ] }] },
    ],
    values: {},
  },
};
```

- [ ] **Step 3: Implementar el componente**

```tsx
// components/configuracion/plantillas/unlayer/unlayer-editor.tsx
"use client";

import { useRef } from "react";
import EmailEditor, { EditorRef } from "react-email-editor";
import { BASE_DESIGN } from "./base-design";

export interface UnlayerEditorApi {
  exportDesign: () => Promise<{ design: any; html: string }>;
}

interface Props {
  initialDesign?: any | null;
  variables?: { name: string; label: string }[];
  brand?: { primary?: string } | null;
  onReady?: (api: UnlayerEditorApi) => void;
}

/** Detecta si un designJson es un diseño Unlayer (tiene body.rows) y no un doc de bloques legacy. */
function isUnlayerDesign(d: any): boolean {
  return !!d && typeof d === "object" && d.body && Array.isArray(d.body.rows);
}

export default function UnlayerEditor({ initialDesign, variables, brand, onReady }: Props) {
  const ref = useRef<EditorRef>(null);

  const mergeTags = (variables ?? []).reduce((acc, v) => {
    acc[v.name] = { name: v.label || v.name, value: `{{${v.name}}}` };
    return acc;
  }, {} as Record<string, { name: string; value: string }>);

  const onLoad = (unlayer: any) => {
    try { unlayer.setMergeTags(mergeTags); } catch { /* versión sin setMergeTags: van en options */ }
    unlayer.loadDesign(isUnlayerDesign(initialDesign) ? initialDesign : BASE_DESIGN);
    onReady?.({
      exportDesign: () =>
        new Promise((resolve) => unlayer.exportHtml((data: any) => resolve({ design: data.design, html: data.html }))),
    });
  };

  return (
    <EmailEditor
      ref={ref}
      onReady={onLoad}
      options={{
        mergeTags,
        appearance: { theme: "modern_light" },
        features: { textEditor: { tables: true } },
      }}
      style={{ height: "100%", minHeight: 600 }}
    />
  );
}
```

> **Verificar en navegador (Task 4):** la API real de la versión instalada de `react-email-editor`. Patrón esperado: `onReady(unlayer)` entrega la instancia con `loadDesign`/`exportHtml`/`setMergeTags`. Si la versión usa `ref.current.editor.*` en vez del arg de `onReady`, adaptar (usar `ref.current!.editor`). Si `setMergeTags` no existe, dejar los merge tags solo en `options.mergeTags`. NO cambiar el contrato `UnlayerEditorApi`.

- [ ] **Step 4: Verificar typecheck/build**

Run: `npm run build`
Expected: compila (el componente aún no se usa; debe tipar). Si `react-email-editor` no trae tipos y `EditorRef` no existe en esta versión, usar `const ref = useRef<any>(null)` y anotarlo.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components/configuracion/plantillas/unlayer/
git commit -m "feat(plantillas): componente UnlayerEditor (react-email-editor) + diseño base"
```

---

## Task 2: Integrar Unlayer en `template-editor` (reemplaza el editor de bloques)

**Files:**
- Modify: `components/configuracion/plantillas/template-editor.tsx`

**Interfaces:**
- Consumes: `UnlayerEditor`/`UnlayerEditorApi` (Task 1), `saveDraft`, `publishVersion`, `restoreVersion` (servicios existentes).
- Produces: `template-editor` usa Unlayer; `onSave` exporta `{design, html}` → `saveDraft({subject, designJson: design, compiledBody: html})`.

- [ ] **Step 1: Reemplazar el editor en `template-editor.tsx`**

Cambios exactos:
1. Imports: quitar `import BlockEditor, { BlockEditorApi } from "./blocks/block-editor";`, `import { EmailDoc } from "./blocks/email-block.types";`, y `import { VariablePalette } from "./variable-palette";`. Agregar `import UnlayerEditor, { UnlayerEditorApi } from "./unlayer/unlayer-editor";` (vía dynamic, ver punto 2) y mantener el resto (OperationHeader, Tabs, PreviewPanel, TestSendDialog, VersionHistory, servicios, toast).
2. Import dinámico client-only: `const UnlayerEditor = dynamic(() => import("./unlayer/unlayer-editor"), { ssr: false });` (ya existe `import dynamic from "next/dynamic"`). Ajustar el import de tipo: `import type { UnlayerEditorApi } from "./unlayer/unlayer-editor";`.
3. `apiRef` tipo: `const apiRef = useRef<UnlayerEditorApi | null>(null);`
4. `onSave`:
```ts
  const onSave = async (): Promise<string | null> => {
    if (!apiRef.current) return null;
    setSaving(true);
    try {
      const { design, html } = await apiRef.current.exportDesign();
      const v = await saveDraft(templateId, { subject, designJson: design, compiledBody: html });
      setDraftVersionId(v.id);
      toast.success?.("Borrador guardado");
      await reload();
      return v.id;
    } catch { toast.error?.("No se pudo guardar"); return null; }
    finally { setSaving(false); }
  };
```
5. Reemplazar el bloque del editor (dentro del `TabsContent value="editor"`) por:
```tsx
            <Card><CardContent className="p-0 h-[640px] overflow-hidden">
              {data && (
                <UnlayerEditor
                  key={working?.id}
                  initialDesign={working?.designJson}
                  variables={data.variables}
                  brand={null}
                  onReady={(api) => { apiRef.current = api; }}
                />
              )}
            </CardContent></Card>
```
6. Quitar el `<VariablePalette .../>` de la columna derecha (Unlayer inserta variables con sus merge tags). Dejar `<VersionHistory .../>`. La columna derecha puede quedar solo con el historial; ajustar el grid si se ve muy vacío (opcional).
7. Mantener la pestaña "Vista previa" (`PreviewPanel`) y `TestSendDialog` en las acciones — siguen funcionando (renderizan el `compiledBody` HTML de Unlayer con sample data).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compila (check-no-stubs). Ya no se referencia `BlockEditor`/`VariablePalette` en `template-editor` (siguen existiendo los archivos; se dejan para no romper otros imports, pero este editor usa Unlayer).

- [ ] **Step 3: Commit**

```bash
git add components/configuracion/plantillas/template-editor.tsx
git commit -m "feat(plantillas): usar Unlayer en el editor de correos (guarda design+html)"
```

---

## Task 3: Verificar `EmailRenderer` con HTML de Unlayer (backend)

**Files:**
- Modify: `src/documents/renderers/email.renderer.spec.ts`
- (Modify solo si el test falla) `src/documents/renderers/email.renderer.ts`

**Interfaces:**
- Consumes: `EmailRenderer.render`.
- Produces: prueba de que `EmailRenderer` renderiza HTML de Unlayer (`compiledBody` HTML plano, `designJson` SIN `.blocks`) interpolando `{{variables}}` y sin intentar compilar MJML.

- [ ] **Step 1: Escribir el test**

Añadir a `src/documents/renderers/email.renderer.spec.ts` (en D:\PMY\pmy-api):

```ts
it('renderiza HTML de Unlayer (designJson sin blocks) interpolando variables', async () => {
  const v: any = {
    subject: 'Hola {{cliente}}',
    designJson: { body: { rows: [] } },            // diseño Unlayer, NO tiene .blocks
    compiledBody: '<html><body><h1>Hola {{cliente}}</h1><p>Guía {{tracking}}</p></body></html>',
  };
  const out = await r.render(v, ctx({ cliente: 'Ana', tracking: 'T1' }));
  expect(out.subject).toBe('Hola Ana');
  expect(out.html).toContain('Hola Ana');
  expect(out.html).toContain('Guía T1');
  expect(out.html).not.toContain('<mjml'); // no intenta compilar MJML
});
```

- [ ] **Step 2: Correr**

Run: `npm test -- email.renderer`
Expected: PASS. (El `EmailRenderer` de Fase 3 usa `designJson.blocks ? composer.compose : compiledBody`; como el diseño Unlayer no tiene `.blocks`, usa `compiledBody` (HTML), corre Handlebars, y al no contener `<mjml` lo devuelve tal cual — ya funciona.) Si por algún motivo fallara, ajustar la condición para tratar HTML plano correctamente sin romper el fallback de bloques legacy, y volver a correr.

- [ ] **Step 3: Commit**

```bash
git add src/documents/renderers/email.renderer.spec.ts src/documents/renderers/email.renderer.ts
git commit -m "test(documents): EmailRenderer renderiza HTML de Unlayer (interpola variables, sin MJML)"
```

---

## Task 4: Verificación end-to-end (navegador)

**Files:** ninguno nuevo.

- [ ] **Step 1: Builds**

`app-pmy`: `npm run build` (OK, check-no-stubs). `pmy-api`: `npm run build` + `npx jest src/documents` (verde).

- [ ] **Step 2: E2E en el navegador (Browser pane)**

Con API `pmy-api` (phase3) + seed + dev server `app-pmy` (:4000), login superadmin:
1. Configuración → Plantillas → abrir un correo (p.ej. *Salida a Ruta*). **Debe cargar el editor Unlayer** (no el editor plano): barra de bloques (Text/Image/Button/Divider/…), panel de estilos, lienzo en vivo. Como ese correo aún no tiene diseño Unlayer, arranca del **diseño base**.
2. **Aplicar estilo real**: escribir texto, ponerlo en **negrita/itálica**, cambiar **tamaño** y **color**, agregar un **botón** y una **imagen** (por URL), cambiar **color de fondo** de una sección. Confirmar que se ve en el lienzo.
3. **Insertar una variable** desde los **Merge Tags** de Unlayer (p.ej. `{{trackingNumber}}`).
4. **Guardar** → Network: `POST documents/templates/:id/draft` con `designJson` (diseño Unlayer, con `body.rows`) y `compiledBody` (HTML con `{{trackingNumber}}` literal). 
5. Pestaña **Vista previa** con sample data → el iframe muestra el HTML con la variable sustituida y el estilo aplicado. **Publicar**. Reabrir → el editor **recarga el diseño Unlayer guardado** (no el base).
6. **Enviar prueba** a un correo → llega (en dev, redirigido a `javier.rappaz@gmail.com`).
Revisar consola/red sin errores. Screenshot del editor Unlayer con estilo aplicado + del preview.

- [ ] **Step 3: Commit final (si hubo ajustes)**

```bash
git add -A && git commit -m "chore(plantillas): verificación E2E editor Unlayer"
```

- [ ] **Step 4: Refrescar grafos**

`app-pmy`: `graphify update .` · `pmy-api`: `graphify update .`

---

## Self-Review (autor)

- **Cobertura del spec (Etapa A, §4):** integración Unlayer + merge tags + branding + guardar design+html → T1/T2; `EmailRenderer` con HTML de Unlayer → T3; lienzo en vivo (preview sin guardar) + variables + estilo real verificados → T4. Editor TipTap de documentos → Etapa B (plan aparte).
- **Consistencia de tipos:** `UnlayerEditorApi.exportDesign(): Promise<{design,html}>`, `saveDraft({subject, designJson, compiledBody})` — idénticos entre T1/T2.
- **Legacy sin romper:** `EmailRenderer` sigue componiendo bloques si `designJson.blocks` existe (correos aún no rediseñados en Unlayer) y usa `compiledBody` HTML si el diseño es Unlayer. No se borra `BlockComposer`.
- **Sin re-seed:** los 12 correos arrancan del diseño base al abrirlos en Unlayer; el usuario los rediseña profesionalmente y guarda (ahí se guarda el HTML de Unlayer). Generar HTML de Unlayer server-side no es viable (requiere su motor de navegador), por eso no se re-siembra.
- **Riesgos:** (1) compatibilidad `react-email-editor` con React 19/Next 16 `output:'export'` — se valida en build + navegador (T4); la API exacta (`onReady(unlayer)` vs `ref.current.editor`) se confirma en T4. (2) Sin `projectId`, no hay asset manager (imágenes por URL) — aceptado. (3) Verificación real es en navegador (Unlayer no corre en tests).
