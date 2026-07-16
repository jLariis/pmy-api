# Motor de Plantillas — Fase 3 Etapa 2: Editor guiado (bloques) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el editor GrapesJS por un **editor de bloques** guiado (agregar/quitar/reordenar bloques + formulario por tipo + insertar variables + preview en vivo), apto para no-técnicos, reusando el resto de la UI de Fase 2. Endurecer el `BlockComposer` del backend para `designJson` arbitrario.

**Architecture:** El editor de bloques mantiene internamente un `EmailDoc` (lista de bloques, espejo del tipo del backend) y expone `{ getDoc(), insertVariable(name) }` vía `onReady` — misma forma que el `GrapesEditorApi` actual, para cambio mínimo en `template-editor.tsx`. Al guardar, el frontend envía `designJson = { blocks }` (el backend de Etapa 1 compone el MJML desde ahí). Se elimina GrapesJS y sus dependencias.

**Tech Stack:** Next 16 (React 19, shadcn UI), `axiosConfig` (Fase 2); backend NestJS (un ajuste en `BlockComposer`).

## Global Constraints

- **Dos repos:** el ajuste de `BlockComposer` va en `D:\PMY\pmy-api` branch **`feat/template-engine-phase3`** (Task 1). El editor de bloques va en `D:\PMY\app-pmy` branch **`feat/template-engine-frontend`** (Tasks 2-4). **NO mergear a main.**
- Ambos repos tienen hook **graphify**: `graphify query "<pregunta>"` antes de leer/editar cualquier archivo fuente.
- **Frontend sin unit tests** (convención): verificación = `npm run build` (incluye `check-no-stubs`, prohíbe stubs/TODOs) + Browser pane. Backend: Jest unit.
- Tipos de bloque del frontend deben **espejar** el backend `EmailBlock` (`pmy-api/src/documents/blocks/email-doc.types.ts`): `heading{text}`, `paragraph{text}`, `button{text,url}`, `image{src,alt?,width?}`, `divider`, `spacer{size}`, `keyValue{items:{label,value}[]}`, `table{columns:{label,key}[],rowsVar}`, `raw{html}`, todos con `id` y `when?`.
- Guardado: `saveDraft(templateId, { subject, designJson: { blocks } })` — NO enviar `compiledBody` (el backend compone desde `designJson.blocks`; `EmailRenderer` prefiere bloques).
- Reusar de Fase 2 SIN tocar: `plantillas-panel.tsx`, `version-history.tsx`, `preview-panel.tsx`, `test-send-dialog.tsx`, `create-template-dialog.tsx`, `branding-panel.tsx`, `lib/services/document-templates.ts`, la ruta `editor/page.tsx`.
- Eliminar: `components/configuracion/plantillas/grapes-editor.tsx` y las deps `grapesjs` + `grapesjs-mjml` de `package.json`.

---

## Task 1: Endurecer `BlockComposer` (pmy-api)

**Files:**
- Modify: `src/documents/blocks/block-composer.ts`
- Modify: `src/documents/blocks/block-composer.spec.ts`

**Interfaces:**
- Produces: `BlockComposer.blockToMjml` con `default` seguro (bloque desconocido → cadena vacía), para `designJson` que escriba el editor.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `block-composer.spec.ts`:

```ts
it('ignora (cadena vacía) un tipo de bloque desconocido sin romper', () => {
  const mjml = composer.compose({ blocks: [
    { id: 'x', type: 'no-existe' as any },
    { id: 'h', type: 'heading', text: 'OK' },
  ] });
  expect(mjml).toContain('OK');           // el bloque válido sigue
  expect(mjml).not.toContain('undefined'); // el desconocido no emite "undefined"
});
```

- [ ] **Step 2: Correr para confirmar el fallo**

Run: `npm test -- block-composer`
Expected: FAIL (hoy `blockToMjml` devuelve `undefined` para tipos no manejados → aparece `undefined` en el MJML).

- [ ] **Step 3: Agregar el `default`**

En `src/documents/blocks/block-composer.ts`, al final del `switch (b.type)` en `blockToMjml`, agregar:

```ts
      default:
        return '';
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- block-composer`
Expected: PASS (los 6 previos + el nuevo).

- [ ] **Step 5: Commit**

```bash
git add src/documents/blocks/block-composer.ts src/documents/blocks/block-composer.spec.ts
git commit -m "fix(documents): BlockComposer ignora tipos de bloque desconocidos (default seguro)"
```

---

## Task 2: Tipos de bloque + componente `BlockEditor` (app-pmy)

**Files:**
- Create: `components/configuracion/plantillas/blocks/email-block.types.ts`
- Create: `components/configuracion/plantillas/blocks/block-editor.tsx`

**Interfaces:**
- Produces:
  - Tipos `EmailBlock`, `EmailDoc`, `BLOCK_TYPES` (lista para el menú "agregar").
  - `BlockEditorApi = { getDoc(): EmailDoc; insertVariable(name: string): void }`.
  - `BlockEditor` (default export) props: `{ initialDoc?: EmailDoc | null; onReady?: (api: BlockEditorApi) => void }`.

- [ ] **Step 1: Crear los tipos (espejo del backend)**

```ts
// components/configuracion/plantillas/blocks/email-block.types.ts
export type EmailBlock =
  | { id: string; when?: string; type: 'heading'; text: string }
  | { id: string; when?: string; type: 'paragraph'; text: string }
  | { id: string; when?: string; type: 'button'; text: string; url: string }
  | { id: string; when?: string; type: 'image'; src: string; alt?: string; width?: number }
  | { id: string; when?: string; type: 'divider' }
  | { id: string; when?: string; type: 'spacer'; size: number }
  | { id: string; when?: string; type: 'keyValue'; items: { label: string; value: string }[] }
  | { id: string; when?: string; type: 'table'; columns: { label: string; key: string }[]; rowsVar: string }
  | { id: string; when?: string; type: 'raw'; html: string };

export type EmailBlockType = EmailBlock['type'];
export interface EmailDoc { blocks: EmailBlock[]; }

export const BLOCK_TYPES: { type: EmailBlockType; label: string }[] = [
  { type: 'heading', label: 'Título' },
  { type: 'paragraph', label: 'Párrafo' },
  { type: 'button', label: 'Botón' },
  { type: 'image', label: 'Imagen' },
  { type: 'keyValue', label: 'Lista campo/valor' },
  { type: 'table', label: 'Tabla' },
  { type: 'divider', label: 'Divisor' },
  { type: 'spacer', label: 'Espacio' },
  { type: 'raw', label: 'HTML crudo' },
];

let seq = 0;
export function newBlock(type: EmailBlockType): EmailBlock {
  const id = `b${Date.now()}_${seq++}`;
  switch (type) {
    case 'heading': return { id, type, text: 'Nuevo título' };
    case 'paragraph': return { id, type, text: 'Nuevo párrafo' };
    case 'button': return { id, type, text: 'Botón', url: '' };
    case 'image': return { id, type, src: '' };
    case 'divider': return { id, type };
    case 'spacer': return { id, type, size: 16 };
    case 'keyValue': return { id, type, items: [{ label: 'Etiqueta', value: '' }] };
    case 'table': return { id, type, columns: [{ label: 'Columna', key: '' }], rowsVar: 'rows' };
    case 'raw': return { id, type, html: '' };
  }
}
```

- [ ] **Step 2: Implementar `BlockEditor`**

```tsx
// components/configuracion/plantillas/blocks/block-editor.tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { EmailBlock, EmailBlockType, EmailDoc, BLOCK_TYPES, newBlock } from "./email-block.types";

export interface BlockEditorApi {
  getDoc: () => EmailDoc;
  insertVariable: (name: string) => void;
}

interface Props {
  initialDoc?: EmailDoc | null;
  onReady?: (api: BlockEditorApi) => void;
}

/** Editor guiado por bloques. Mantiene el EmailDoc internamente; expone getDoc()/insertVariable() por onReady. */
export default function BlockEditor({ initialDoc, onReady }: Props) {
  const [blocks, setBlocks] = useState<EmailBlock[]>(initialDoc?.blocks ?? []);
  const blocksRef = useRef<EmailBlock[]>(blocks);
  blocksRef.current = blocks;
  // Campo de texto con foco (para insertar variables en el cursor).
  const focusedRef = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; apply: (v: string) => void } | null>(null);
  const readyRef = useRef(false);

  if (!readyRef.current && onReady) {
    readyRef.current = true;
    onReady({
      getDoc: () => ({ blocks: blocksRef.current }),
      insertVariable: (name: string) => {
        const token = `{{${name}}}`;
        const f = focusedRef.current;
        if (!f) return;
        const el = f.el;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = el.value.slice(0, start) + token + el.value.slice(end);
        f.apply(next);
        requestAnimationFrame(() => { el.focus(); const p = start + token.length; el.setSelectionRange(p, p); });
      },
    });
  }

  const update = (id: string, patch: Partial<EmailBlock>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)));
  const add = (type: EmailBlockType) => setBlocks((bs) => [...bs, newBlock(type)]);
  const remove = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const move = (i: number, dir: -1 | 1) => setBlocks((bs) => {
    const j = i + dir; if (j < 0 || j >= bs.length) return bs;
    const c = [...bs]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  /** Registra un campo de texto como "enfocado" para insertar variables. */
  const bindFocus = (apply: (v: string) => void) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { focusedRef.current = { el: e.currentTarget, apply }; },
  });

  return (
    <div className="space-y-3 p-3 overflow-auto h-full">
      {blocks.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Sin bloques. Agrega el primero abajo.</p>}
      {blocks.map((b, i) => (
        <div key={b.id} className="rounded-lg border p-3 space-y-2 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{BLOCK_TYPES.find((t) => t.type === b.type)?.label ?? b.type}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === blocks.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
          </div>
          <BlockFields block={b} update={update} bindFocus={bindFocus} />
        </div>
      ))}

      <div className="flex items-center gap-2 pt-2">
        <Select onValueChange={(v) => add(v as EmailBlockType)}>
          <SelectTrigger className="w-[220px]"><span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" /> Agregar bloque</span></SelectTrigger>
          <SelectContent>
            {BLOCK_TYPES.map((t) => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function BlockFields({ block: b, update, bindFocus }: {
  block: EmailBlock;
  update: (id: string, patch: Partial<EmailBlock>) => void;
  bindFocus: (apply: (v: string) => void) => { onFocus: (e: any) => void };
}) {
  switch (b.type) {
    case 'heading':
      return <Input value={b.text} {...bindFocus((v) => update(b.id, { text: v } as any))} onChange={(e) => update(b.id, { text: e.target.value } as any)} placeholder="Título (admite {{variables}})" />;
    case 'paragraph':
      return <Textarea value={b.text} {...bindFocus((v) => update(b.id, { text: v } as any))} onChange={(e) => update(b.id, { text: e.target.value } as any)} placeholder="Párrafo (admite HTML simple y {{variables}})" />;
    case 'button':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input value={b.text} {...bindFocus((v) => update(b.id, { text: v } as any))} onChange={(e) => update(b.id, { text: e.target.value } as any)} placeholder="Texto del botón" />
          <Input value={b.url} {...bindFocus((v) => update(b.id, { url: v } as any))} onChange={(e) => update(b.id, { url: e.target.value } as any)} placeholder="URL (p.ej. {{resetLink}})" />
        </div>
      );
    case 'image':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input value={b.src} {...bindFocus((v) => update(b.id, { src: v } as any))} onChange={(e) => update(b.id, { src: e.target.value } as any)} placeholder="URL de la imagen" />
          <Input value={b.alt ?? ''} onChange={(e) => update(b.id, { alt: e.target.value } as any)} placeholder="Texto alternativo" />
        </div>
      );
    case 'spacer':
      return <Input type="number" value={b.size} onChange={(e) => update(b.id, { size: Number(e.target.value) } as any)} placeholder="Altura (px)" />;
    case 'divider':
      return <p className="text-xs text-muted-foreground">Línea divisoria.</p>;
    case 'raw':
      return <Textarea value={b.html} {...bindFocus((v) => update(b.id, { html: v } as any))} onChange={(e) => update(b.id, { html: e.target.value } as any)} placeholder="HTML crudo (p.ej. {{{tableHtml}}})" className="font-mono text-xs" />;
    case 'keyValue':
      return (
        <div className="space-y-1">
          {b.items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2">
              <Input value={it.label} onChange={(e) => { const items = [...b.items]; items[idx] = { ...it, label: e.target.value }; update(b.id, { items } as any); }} placeholder="Etiqueta" />
              <Input value={it.value} {...bindFocus((v) => { const items = [...b.items]; items[idx] = { ...it, value: v }; update(b.id, { items } as any); })} onChange={(e) => { const items = [...b.items]; items[idx] = { ...it, value: e.target.value }; update(b.id, { items } as any); }} placeholder="Valor (p.ej. {{fecha}})" />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => update(b.id, { items: [...b.items, { label: '', value: '' }] } as any)}><Plus className="h-3.5 w-3.5 mr-1" /> Agregar fila</Button>
        </div>
      );
    case 'table':
      return (
        <div className="space-y-1">
          <Input value={b.rowsVar} onChange={(e) => update(b.id, { rowsVar: e.target.value } as any)} placeholder="Variable-lista de filas (p.ej. rows)" />
          {b.columns.map((c, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2">
              <Input value={c.label} onChange={(e) => { const columns = [...b.columns]; columns[idx] = { ...c, label: e.target.value }; update(b.id, { columns } as any); }} placeholder="Encabezado" />
              <Input value={c.key} onChange={(e) => { const columns = [...b.columns]; columns[idx] = { ...c, key: e.target.value }; update(b.id, { columns } as any); }} placeholder="Campo del dato (p.ej. trackingNumber)" />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => update(b.id, { columns: [...b.columns, { label: '', key: '' }] } as any)}><Plus className="h-3.5 w-3.5 mr-1" /> Agregar columna</Button>
        </div>
      );
  }
}
```

> Nota: `BlockEditor` usa `onReady` una sola vez (patrón del `GrapesEditor` actual). El `template-editor` monta el editor con `key={working?.id}` (ya lo hace), así que al cambiar de versión React lo re-monta y `onReady` re-registra el api con el nuevo `initialDoc`.

- [ ] **Step 3: Verificar typecheck/build**

Run: `npm run build`
Expected: compila (el componente aún no se usa; debe tipar).

- [ ] **Step 4: Commit**

```bash
git add components/configuracion/plantillas/blocks/
git commit -m "feat(plantillas): editor de bloques guiado (tipos + BlockEditor)"
```

---

## Task 3: Integrar `BlockEditor` en `template-editor` y quitar GrapesJS (app-pmy)

**Files:**
- Modify: `components/configuracion/plantillas/template-editor.tsx`
- Delete: `components/configuracion/plantillas/grapes-editor.tsx`
- Modify: `package.json` (quitar `grapesjs`, `grapesjs-mjml`)

**Interfaces:**
- Consumes: `BlockEditor` / `BlockEditorApi` (Task 2), `saveDraft` (envía `designJson`).
- Produces: `template-editor.tsx` usando el editor de bloques; `getDoc()` alimenta `saveDraft`.

- [ ] **Step 1: Reemplazar el editor en `template-editor.tsx`**

Cambios exactos en `components/configuracion/plantillas/template-editor.tsx`:

1. Imports: quitar `import dynamic from "next/dynamic";` NO (se sigue usando para BlockEditor si se desea ssr:false; el BlockEditor es client puro, se puede importar directo). Reemplazar la línea del GrapesEditor:
   - Quitar: `import type { GrapesEditorApi } from "./grapes-editor";` y `const GrapesEditor = dynamic(() => import("./grapes-editor"), { ssr: false });`
   - Agregar: `import BlockEditor, { BlockEditorApi } from "./blocks/block-editor";` y `import { EmailDoc } from "./blocks/email-block.types";`
2. `apiRef` type: `const apiRef = useRef<BlockEditorApi | null>(null);`
3. `onSave`: reemplazar el cuerpo que usa `getContent()`:
```ts
  const onSave = async (): Promise<string | null> => {
    if (!apiRef.current) return null;
    setSaving(true);
    try {
      const doc = apiRef.current.getDoc();
      const v = await saveDraft(templateId, { subject, designJson: doc });
      setDraftVersionId(v.id);
      toast.success?.("Borrador guardado");
      await reload();
      return v.id;
    } catch { toast.error?.("No se pudo guardar"); return null; }
    finally { setSaving(false); }
  };
```
4. Reemplazar el bloque `<GrapesEditor .../>` dentro del `<Card><CardContent>`:
```tsx
            <Card><CardContent className="p-0 h-[600px] overflow-hidden">
              {data && (
                <BlockEditor
                  key={working?.id}
                  initialDoc={(working?.designJson && Array.isArray(working.designJson.blocks) ? working.designJson : { blocks: [] }) as EmailDoc}
                  onReady={(api) => { apiRef.current = api; }}
                />
              )}
            </CardContent></Card>
```
   (Se elimina `onDestroy`; `BlockEditor` no lo necesita — no hay instancia externa que destruir. El `key` fuerza re-montaje al cambiar de versión.)
5. La paleta ya llama `apiRef.current?.insertVariable(n)` — sin cambios (la API lo expone).

- [ ] **Step 2: Eliminar GrapesJS**

```bash
git rm components/configuracion/plantillas/grapes-editor.tsx
npm uninstall grapesjs grapesjs-mjml
```

- [ ] **Step 3: Verificar que no queden referencias**

Run (tras graphify): `grep -rn "grapes" components/ lib/ app/ 2>/dev/null` — no debe haber referencias a GrapesJS en el código de la app (fuera de node_modules).
Expected: sin resultados.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compila (incluye `check-no-stubs`); no falta el módulo grapes (ya no se referencia).

- [ ] **Step 5: Commit**

```bash
git add components/configuracion/plantillas/template-editor.tsx package.json package-lock.json
git commit -m "feat(plantillas): usar editor de bloques en template-editor; quitar GrapesJS"
```

---

## Task 4: Verificación end-to-end (app-pmy)

**Files:** ninguno nuevo.

- [ ] **Step 1: Build + lint**

Run: `npm run build` (OK, check-no-stubs) y `npx next lint` (sin errores nuevos).

- [ ] **Step 2: E2E en el navegador (Browser pane)**

Con la API `pmy-api` (branch phase3) corriendo + `npm run seed` (para tener los 12 correos como bloques) + dev server `app-pmy` (`npm run dev`, puerto 4000), login superadmin:
1. Configuración → Plantillas → abrir `route_dispatch`. El editor de bloques carga los bloques sembrados (heading, paragraph, keyValue) — NO GrapesJS.
2. Editar el texto de un bloque; colocar el cursor en un campo y clic en una variable de la paleta → inserta `{{...}}` en el cursor.
3. Agregar un bloque (p.ej. Párrafo), reordenar con ↑↓, eliminar.
4. "Guardar" → Network `POST .../draft` 201; confirmar que el payload lleva `designJson.blocks` (array de bloques), sin `compiledBody`.
5. Pestaña "Vista previa" → render del server muestra el correo compuesto desde bloques con variables sustituidas.
6. "Publicar" (un clic) → draft + publish; "Restaurar" una versión → recarga el editor con esos bloques.
Revisar consola/red sin errores. Screenshot del editor de bloques + del preview como evidencia.

- [ ] **Step 3: Commit final (si hubo ajustes de lint)**

```bash
git add -A && git commit -m "chore(plantillas): verificación E2E editor de bloques"
```

- [ ] **Step 4: Refrescar grafo**

Run: `graphify update .`

---

## Self-Review (autor)

- **Cobertura del spec (Etapa 2, §6):** editor de bloques (agregar/quitar/reordenar/editar + paleta + preview) → T2/T3; reemplaza GrapesJS → T3; reusa lista/versiones/preview/test-send/branding (sin tocar) → constraint; `default` seguro en BlockComposer (minor de Etapa 1) → T1. Editor de columnas (Excel) se difiere a Etapa 4 (no hay ExcelRenderer aún) — YAGNI, anotado.
- **Consistencia de tipos:** `EmailDoc { blocks: EmailBlock[] }` espeja el backend; `BlockEditorApi { getDoc(): EmailDoc; insertVariable(name) }` reemplaza `GrapesEditorApi { getContent(); insertVariable }`; `template-editor.onSave` usa `getDoc()` → `saveDraft({subject, designJson})`.
- **Guardado:** se envía `designJson` (bloques); el backend de Etapa 1 compone MJML desde ahí (EmailRenderer prefiere `designJson.blocks`). No se envía `compiledBody`.
- **Riesgo:** el editor de bloques no representa versiones legacy que solo tengan `compiledBody` MJML sin `blocks` (arranca vacío). Aceptable: los 12 correos re-sembrados en Etapa 1 tienen `designJson.blocks`; crear nuevo arranca vacío y se agregan bloques.
- **Verificación:** sin unit tests de UI (convención); build + `check-no-stubs` + E2E navegador (T4).
