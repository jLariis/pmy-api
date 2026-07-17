# Motor de Plantillas — Fase 4: Editores profesionales (Unlayer correos + editor documento reportes)

> **Spec de diseño.** Fase 4 — reemplaza el editor de bloques "plano" por editores visuales profesionales. Repos: `app-pmy` (editores, grueso) + `pmy-api` (ajuste de render/almacenamiento). Fecha: 2026-07-17.

## 1. Contexto y el giro

La Fase 3 entregó el motor (email/PDF/Excel) + un **editor de bloques por formularios**. Feedback del usuario (con imágenes de referencia de constructores profesionales): el editor de bloques es **plano, 0% profesional** — sin negritas, itálicas, subrayado, tamaños, colores, fondos, ni orden visual; y el preview **exige guardar un borrador** en vez de mostrarse en vivo. El usuario espera algo como una **mezcla de esos constructores**: edición **visual con estilo real** y **lienzo en vivo**.

Esta fase reemplaza la capa de edición por **dos editores maduros/profesionales**, conservando todo el backend (render, variables, branding, versionado, test-send, Excel, motor Chromium).

## 2. Decisiones (brainstorming)

| Decisión | Elección |
|---|---|
| Editor de **correos** | **Unlayer (`react-email-editor`)** — bloques drag-drop, rich-text (B/I/U, tamaños, colores, fondos), estilo por elemento, lienzo en vivo, plantillas pro (≈ imágenes 1 y 3) |
| Editor de **documentos redactados** (cartas, comprobantes, reportes narrativos) | **Editor tipo documento con TipTap** — TOC de secciones + rich-text + panel de estilos + branding (≈ imágenes 2 y 4) |
| **Reportes tabulares/analytics** (choferes, estado de resultados, sin-67, salida a ruta) | **Se generan por código**; la plantilla controla presentación (Etapa 3a/4a). NO entran a un editor de prosa |
| Preview | **En vivo en el lienzo** (lo que se ve es el correo/documento) — sin "guardar primero" |

## 3. Qué se conserva vs. se reemplaza

**Se conserva (backend, Fase 1–3):** `TemplateService.render`, entidades/versionado, `TemplateEngine` (Handlebars para `{{variables}}`), `BrandingService`, `TemplateStore`, admin/CRUD/publish/restore/test-send, `HtmlToPdfService` (Chromium), `ExcelRenderer`/`ExcelDoc` (reportes tabulares), `RendererRegistry`.

**Se reemplaza / deprecia:**
- Editor de bloques del frontend (Etapa 2) → **Unlayer** para correos.
- Modelo `EmailDoc`/`BlockComposer` (Etapa 1) para correos → el correo guarda el **diseño de Unlayer (JSON) + HTML exportado**; `EmailRenderer` interpola `{{variables}}`/branding sobre ese HTML. (Queda en branch sin mergear; no afecta main.)
- `PdfHtmlComposer`/`PdfDoc` para documentos **redactados** → los produce el editor TipTap (HTML) → Chromium. (El `PdfDoc` puede seguir sirviendo al PDF tabular de bodega, o migrarse; a decidir en su etapa.)

## 4. Editor de correos — Unlayer (`react-email-editor`)

- **Integración (app-pmy):** componente client-only (`dynamic ssr:false`) que monta `<EmailEditor>` de `react-email-editor`. Reemplaza `BlockEditor`/`template-editor` actuales; se reusa la lista/versiones/branding/test-send de Fase 2.
- **Almacenamiento:** al guardar, `editor.exportHtml((data) => …)` da `{ design (JSON), html }`. Se guarda `designJson = design` (para re-editar) y `compiledBody = html` (para render). El backend NO recompone: `EmailRenderer` toma `compiledBody` (HTML de Unlayer), corre Handlebars para `{{variables}}` + tokens de marca, y devuelve el HTML final. (El camino MJML/bloques de Fase 1–3 deja de usarse para correos.)
- **Variables:** se registran como **merge tags** de Unlayer (`{{tracking}}`, etc.) desde los `TemplateVariableDef` de la plantilla → el usuario las inserta desde el panel de Unlayer; en el HTML quedan como `{{var}}` que Handlebars resuelve al render.
- **Branding:** colores/logo por defecto se pasan a la config de Unlayer (appearance/defaults) y/o como merge tags de branding.
- **Preview:** en vivo en el lienzo de Unlayer; además el preview server (render con sample data) se mantiene para "ver como lo recibe el destinatario".
- **Freemium:** el editor embebido es gratis; el hosting de imágenes/assets y algunas funciones avanzadas requieren cuenta Unlayer (`projectId`). Sin `projectId` funciona el diseño + export HTML (suficiente). *Decisión operativa: usar sin projectId al inicio; evaluar cuenta si se necesita subir imágenes.*

## 5. Editor de documentos redactados — TipTap (≈ img 2/4)

- **Alcance:** cartas, comprobantes, reportes **narrativos** (prosa + secciones). Nuevo(s) `type` de plantilla (`letter`/`document`) autor-editables.
- **UI (app-pmy):** layout de 3 zonas — **TOC de secciones** (izquierda, agregar/reordenar), **documento rich-text** (centro, TipTap: párrafos, encabestros, listas, negrita/itálica/subrayado, tamaños, color, alineación, interlineado), **panel de estilos + branding** (derecha). Botones Guardar borrador / Publicar / Vista previa / (Enviar/PDF).
- **Almacenamiento:** `designJson = documento TipTap (JSON)`; `compiledBody = HTML` renderizado por TipTap. Admite `{{variables}}` embebidas (Handlebars al render).
- **Salida:** para PDF, el HTML del documento (+ marca) → **`HtmlToPdfService` (Chromium)** ya existente → PDF. Un `DocumentRenderer` para `type='letter'/'document'` (o reuso de `PdfRenderer` con `compiledBody` HTML directo en vez de `PdfDoc`).
- **Preview:** en vivo (TipTap ES el documento) + preview server con sample data.

## 6. Reportes tabulares (sin cambio de rumbo)

`driver_report`, `income_statement`, `inventory_no67`, `shipments_no67`, `received_67`, `pending_shipments`, `warehouse_dispatch_*` y los 5 del frontend: **se generan por código** (consultas/agregaciones/semáforos/columnas dinámicas), con la plantilla `ExcelDoc`/`PdfDoc` controlando **presentación** (Etapa 3a/4a). NO se editan en un editor de prosa. Su "edición" (labels/orden/visibilidad/formato de columnas) es un editor de columnas simple, futuro.

## 7. Restricciones del stack

- **app-pmy:** Next 16 (app router, `output:'export'`), React 19. Dep nueva **`react-email-editor`** (Unlayer) para correos y **`@tiptap/react` + extensiones** (StarterKit, Underline, TextStyle, Color, TextAlign, etc.) para documentos. Ambos editores client-only (`dynamic ssr:false`). shadcn UI para el chrome. Sin unit tests de UI (build + navegador). `check-no-stubs`.
- **pmy-api:** `EmailRenderer` pasa a renderizar HTML de Unlayer (Handlebars sobre `compiledBody`), no MJML/bloques. Nuevo/ajustado renderer para documentos TipTap → HTML → `HtmlToPdfService`. Best-effort/never-throws intactos.
- Contenido: `designJson` (diseño del editor) + `compiledBody` (HTML) por versión; el `type` distingue email vs documento vs tabular.

## 8. Alcance y etapas

- **Etapa A — Correos con Unlayer:** integrar `react-email-editor` en app-pmy (reemplaza el editor plano), merge tags desde `TemplateVariableDef`, branding, guardar `design+html`; ajustar `EmailRenderer` a HTML de Unlayer + Handlebars; re-sembrar los correos como plantillas Unlayer profesionales (o partir de plantillas base Unlayer). Preview en vivo + test-send.
- **Etapa B — Editor de documentos TipTap:** editor TOC + rich-text + estilos + branding; `type='letter'/'document'`; render HTML → Chromium PDF; plantillas base (carta, comprobante). 
- (Reportes tabulares y sus editores de columnas: fases posteriores, ya encaminados en Etapa 3a/4a.)

## 9. Criterios de aceptación

1. El editor de correos es **visual y profesional** (Unlayer): negritas/itálicas/subrayado/tamaños/colores/fondos, bloques drag-drop, **lienzo en vivo**; el preview NO exige guardar primero.
2. Las **variables** se insertan desde el editor (merge tags) y se resuelven al render; el branding se refleja.
3. Guardar/publicar/restaurar/test-send siguen funcionando con el nuevo formato (`design+html`).
4. El editor de **documentos** (TipTap) permite redactar con secciones + rich-text + estilos + branding, y exportar/previsualizar (PDF vía Chromium).
5. Los reportes tabulares siguen generándose por código sin regresión.
6. Builds verdes (app-pmy `npm run build` + `check-no-stubs`; pmy-api build + tests); nada mergeado a main (branches).

## 10. Riesgos / preguntas abiertas

- **Unlayer freemium:** sin `projectId` funciona diseño + export HTML; subir imágenes/asset manager requiere cuenta. Definir si se usa cuenta Unlayer o se suben imágenes por otro medio (URLs/branding).
- **React 19 + Next 16 (`output:'export'`)** con `react-email-editor` y TipTap: confirmar compatibilidad (ambos client-only con `dynamic ssr:false`); validar en build.
- **Migración de correos ya sembrados:** los 12 correos de Fase 3 (bloques) se re-crean como plantillas Unlayer (partiendo de plantillas base pro), preservando variables. El modelo de bloques se deprecia para correos.
- **`PdfDoc` de bodega:** decidir si el PDF tabular de bodega se queda con `PdfDoc` (Etapa 3a) o migra; el editor TipTap es solo para documentos redactados.
- Editor de columnas para reportes tabulares: fuera de esta fase.
