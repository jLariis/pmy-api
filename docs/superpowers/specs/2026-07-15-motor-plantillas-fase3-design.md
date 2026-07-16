# Motor de Plantillas — Fase 3: Editor guiado + cualquier documento (Email, PDF, Excel) con precarga fiel

> **Spec de diseño.** Fase 3 — rediseño del editor (sin GrapesJS) y extensión a PDF/Excel con precarga fiel de TODOS los documentos actuales. Repos: `pmy-api` (motor/renderers/seed) + `app-pmy` (editor guiado). Fecha: 2026-07-15.

## 1. Contexto y el giro

Fases 1–2 entregaron el motor (`TemplateService.render`), el `EmailRenderer` (MJML), el seed de 12 correos, y una UI (Fase 2, **sin mergear**) con editor **GrapesJS**. Feedback del usuario:

1. **GrapesJS es demasiado complejo** — no es para "cualquier persona". Se quiere algo **simple pero profesional**.
2. Se pidió **cualquier documento**, no solo correos — faltan **PDF y Excel**.
3. Los documentos actuales (correos + PDFs + Excels) **no están precargados** con el nuevo diseño.

Esta fase corrige las tres cosas: reemplaza el editor por uno **guiado por bloques/columnas**, agrega **PdfRenderer** y **ExcelRenderer**, y **precarga los 31 documentos** actuales con paridad. Contrato de paridad detallado: [document-inventory.md](../references/document-inventory.md) (12 correos + 9 backend + 10 frontend).

## 2. Decisiones (brainstorming)

| Decisión | Elección |
|---|---|
| Editor | **Reemplazar GrapesJS** por editor guiado simple (bloques para email/PDF, columnas para Excel) + preview en vivo. Nadie parte de lienzo en blanco. |
| Formatos | **Email + PDF + Excel** en esta fase. |
| Uso | Plantillas **precargadas**; edición ocasional por admin (crear desde cero es raro). |
| Motor PDF | **Chromium headless** (`playwright-core`) HTML→PDF, mismo diseño que el email. |
| Reportes (9 backend) | Plantilla = **presentación** (marca, título, columnas: etiqueta/orden/visibilidad/ancho/formato, encabezado/pie). **Datos y lógica (agregaciones, semáforos, columnas dinámicas) permanecen en código.** Reproducir el diseño lo **más idéntico** posible. |
| Docs del frontend (10) | **Portar el diseño al backend/motor**, **conservando intacto** el código/métodos/archivos del frontend como **respaldo** (no se borra nada). |
| Plan | Un spec; ejecución **por etapas** (ver §9). |

## 3. Modelos de contenido

Tres esquemas JSON, guardados en `DocumentTemplateVersion.designJson` (fuente de verdad; el `compiledBody` pasa a ser salida generada/caché, opcional).

### 3.1 `EmailDoc` (email) — bloques
Lista ordenada de bloques con marca aplicada por el layout:
```
{ blocks: [
  { id, type: 'heading',   text }                    // admite {{var}}
  { id, type: 'paragraph', text }                    // texto enriquecido lite (negrita/enlace)
  { id, type: 'button',    text, url }
  { id, type: 'image',     src, alt, width? }
  { id, type: 'divider' }
  { id, type: 'spacer',    size }
  { id, type: 'table',     columns:[{label,key}], rowsVar }   // filas desde una variable-lista
  { id, type: 'keyValue',  items:[{label, valueVar}] }
  { id, type: 'signature', name, role }
]}
```

### 3.2 `PdfDoc` (pdf) — layout de reporte (superset de bloques)
```
{ page: { size:'LETTER'|'A4', orientation:'landscape'|'portrait', margins },
  header: { logo, title, showDateTime },
  blocks: [ …EmailDoc blocks… +
    { type:'infoGrid', cells:[{label, valueVar}] }
    { type:'symbology', text }
    { type:'statBoxes', boxes:[{label, valueVar}] }
    { type:'table', columns:[{label,key,width,align,format}], rowsVar,
      rowRules:[{ when:'ruleName', fill }],          // reglas nombradas, evaluadas en código
      variantsVar? }                                  // p.ej. quitar col 'HORA' si Hermosillo
    { type:'signatures', slots:[{label}] }
    { type:'footer', text }
  ]}
```
Se compone a HTML (BlockComposer) y se convierte a PDF con Chromium.

### 3.3 `ExcelDoc` (excel) — hojas + columnas
```
{ sheets: [ {
    name, title, subtitle?, infoRows?:[{label, valueVar}],
    headerRow?: number,                               // p.ej. driver report cabecera en fila 4
    freezeHeader?: bool, autoFilter?: bool,
    headerFill, headerFont,
    columns: [ { key, label, width, numFmt?, align?, visible?, order? } ],
    dynamicColumns?: { fromVar, labelFrom, numFmt },  // p.ej. una col por día (income statement)
    conditionalRules?: [ { name, target, colors } ],  // semáforo/colorScale — evaluado en código
    rowsVar
  } ] }
```

**Regla de reportes (§2):** la plantilla define lo de arriba (presentación). El **código** de cada reporte produce `rowsVar`/`dynamicColumns`/evalúa `rowRules`/`conditionalRules` y llama al renderer con `{ data, rows, dynamicCols }`. La plantilla NO reprograma el reporte.

## 4. Arquitectura de render

```
TemplateService.render(code, data)   (núcleo Fase 1, se queda)
  └─ RendererRegistry → por template.type
       ├─ EmailRenderer  : BlockComposer(EmailDoc, brand, data) → MJML → HTML          (refactor)
       ├─ PdfRenderer     : BlockComposer(PdfDoc, brand, data) → HTML → playwright PDF  (nuevo)
       └─ ExcelRenderer   : ExcelDoc + rows + brand → exceljs Workbook → Buffer         (nuevo)

BlockComposer (nuevo, compartido email/PDF): bloques + tokens de marca + {{variables}} (Handlebars) → HTML/MJML.
```

- **EmailRenderer** deja de recibir MJML crudo: compone desde `EmailDoc` (BlockComposer) → MJML → HTML (mantiene la compilación MJML async de Fase 1).
- **PdfRenderer** (nuevo): compone `PdfDoc` → HTML branded → `playwright-core` (Chromium headless) `page.pdf()`. Best-effort/fallback como el resto (nunca rompe la operación).
- **ExcelRenderer** (nuevo): aplica `ExcelDoc` (presentación) sobre `rows`/`dynamicColumns` que entrega el código, con `exceljs`. Reusa colores de marca donde el diseño lo permita.
- **Datos para reportes/adjuntos**: el servicio que hoy genera el documento (backend) o el nuevo servicio portado (para los del frontend) calcula los datos y llama al renderer con el `code` + `{ data, rows }`. Presentación en plantilla, datos en código.

## 5. Precarga fiel + estrategia de "respaldo"

- **Correos (12):** re-seed como `EmailDoc` (bloques) equivalentes al MJML actual. Paridad de variables (contrato Fase 1).
- **Reportes backend (9):** seed de `ExcelDoc`/`PdfDoc` que **reproducen** columnas/colores/formatos del inventario. Refactor de cada servicio (driver report, income statement, inventory 67, shipments 67, received 67, pending, audit, warehouse pdf+excel) para: calcular datos → `render(code, { data, rows, dynamicCols })`. El endpoint de descarga sigue igual; el output debe verse igual (criterio de aceptación de paridad visual).
- **Docs del frontend (10):** portar el diseño a `PdfDoc`/`ExcelDoc` en el backend + un servicio que arme sus datos desde el payload de la operación. **El código del frontend que los genera hoy se conserva intacto como respaldo/fallback** (no se borra ni se desconecta en esta fase). La conmutación del flujo de correo (usar el adjunto generado por el motor en vez del subido por el navegador) es un **corte controlado posterior**, detrás de flag — Fase 3 deja la capacidad lista y verificable, sin forzar el corte.

Criterio transversal: **paridad** — cada documento del inventario se genera con el motor de forma visualmente equivalente al actual antes de darlo por migrado.

## 6. Editor guiado (app-pmy) — reemplaza GrapesJS

- **Editor de bloques** (email/PDF): lista de bloques con agregar / quitar / reordenar (↑↓) / editar campos (formulario por tipo de bloque) + **paleta de variables** (insertar `{{var}}`) + **vista previa en vivo** (iframe con render del server). Sin lienzo.
- **Editor de columnas** (excel): tabla para reordenar / mostrar-ocultar / renombrar / ancho / formato de columnas + título/subtítulo + opciones (congelar, autofiltro). Preview: descarga/preview del Excel con datos de ejemplo.
- **Reusar de Fase 2** (rescatar del branch `feat/template-engine-frontend`): lista de plantillas, versiones/restore, preview, test-send, panel de Branding, capa de servicios. **Descartar**: `grapes-editor.tsx` + deps `grapesjs`/`grapesjs-mjml`.
- Crear nuevo = partir de una **plantilla base** por tipo (no de cero). Todo bajo `SuperAdminGuard`/rol superadmin (como Fase 2).

## 7. Restricciones del stack

- **pmy-api:** NestJS + TypeORM; motor en `src/documents/` (Fase 1). Nueva dep `playwright-core` (+ un Chromium disponible en el server — documentar instalación/entorno). `exceljs` ya está. Renderers implementan `DocumentRenderer` (Fase 1). Best-effort: `render()` nunca lanza. Tests: Jest unit con mocks. Migraciones si el esquema cambia (probablemente NO — todo cabe en `designJson`).
- **app-pmy:** Next 16 (static export `output:'export'` — rutas dinámicas usan `?id=`, ver Fase 2), React 19, shadcn UI, `axiosConfig`. Sin unit tests de UI (build + browser). `check-no-stubs` prohíbe stubs.
- El endpoint `GET documents/templates/:id/edit` (Fase 2) es requerido por el editor — ver §11 (estrategia de branches).

## 8. Modelo de datos

Sin tablas nuevas: el contenido (`EmailDoc`/`PdfDoc`/`ExcelDoc`) vive en `DocumentTemplateVersion.designJson`; `type` distingue el formato; el resto de entidades de Fase 1 se reusan. (Si un reporte necesita marcar "columnas dinámicas" u otra metadata, va dentro del `designJson`.)

## 9. Alcance y etapas

Un solo diseño; ejecución en **4 etapas** (cada una = su propio plan ejecutable, en orden; cada etapa entrega algo funcional):

- **Etapa 1 — Núcleo de bloques + Email:** `BlockComposer`, esquema `EmailDoc`, refactor `EmailRenderer` a bloques, re-seed de los 12 correos como bloques. (Backend; correos en el nuevo modelo con paridad.)
- **Etapa 2 — Editor guiado (frontend):** editor de bloques + editor de columnas (scaffolding), reusar UI de Fase 2, descartar GrapesJS. Correos editables de punta a punta.
- **Etapa 3 — PDF:** `PdfRenderer` (playwright-core) + esquema `PdfDoc`; seed + wire del PDF de backend (`warehouse_dispatch_pdf`) y los 5 PDFs del frontend (fieles), conservando el frontend como respaldo.
- **Etapa 4 — Excel:** `ExcelRenderer` + esquema `ExcelDoc`; seed + refactor de los 8 Excel de backend + 5 del frontend (presentación; datos en código), conservando el frontend como respaldo.

## 10. Criterios de aceptación

1. `render(code, data)` produce Email (bloques→MJML→HTML), PDF (bloques→HTML→Chromium) y Excel (columnas→exceljs) y **nunca lanza**.
2. Los **12 correos** se generan desde bloques con paridad de variables.
3. Los **9 reportes de backend** siguen descargándose por sus endpoints actuales, ahora renderizados vía plantilla, **visualmente equivalentes** (columnas/orden/colores/formatos del inventario), con datos/lógica intactos.
4. Los **10 documentos del frontend** tienen su equivalente generado por el motor (verificable), **sin borrar** el código del frontend.
5. El **editor guiado** permite: editar bloques (email/PDF) y columnas (excel), insertar variables, ver preview en vivo, guardar/publicar/restaurar, test-send — sin GrapesJS, apto para no-técnicos.
6. Branding global se refleja en todos los formatos.
7. Builds verdes: `pmy-api` (`npm run build` + tests de los renderers/composer) y `app-pmy` (`npm run build` + `check-no-stubs`). Paridad verificada en navegador/descarga por documento.

## 11. Migración y estrategia de branches

- **Fase 1** está en `main`. **Fase 2** quedó en branches sin mergear: `feat/template-engine-phase2` (pmy-api: endpoint `:id/edit` + specs) y `feat/template-engine-frontend` (app-pmy: UI incl. GrapesJS).
- **Recomendación:** mergear a `main` el **endpoint `:id/edit`** de Fase 2 (es útil y requerido) — o re-incluirlo en la rama de Fase 3. La **UI de Fase 2** se **rescata parcialmente** (lista, versiones, preview, test-send, branding, servicios) en la rama de Fase 3; se **descarta el editor GrapesJS**. Esta es una **decisión abierta** para el usuario: (a) mergear Fase 2 backend a main y construir Fase 3 encima, o (b) plegar todo Fase 2 útil dentro de Fase 3.
- Ramas de Fase 3: `feat/template-engine-phase3` (pmy-api) + una rama frontend en `app-pmy`.
- **Nada del frontend que genera documentos hoy se borra** (respaldo).

## 12. Riesgos / preguntas abiertas

- **playwright-core en el servidor:** requiere un binario de Chromium (~150 MB) instalado en el entorno de despliegue. Confirmar que el hosting lo permite; si no, plan B (`pdfmake` por bloques) — menos fiel.
- **Fidelidad de reportes complejos** (semáforos, colorScale, multi-hoja, columnas por día): el esquema `ExcelDoc`/`PdfDoc` debe capturarlos; se validará por paridad visual documento a documento. Reproducir "idéntico" puede requerir iteración por reporte.
- **Volumen:** 31 documentos + 3 renderers + editor es grande; por eso las 4 etapas. Cada etapa se planifica y ejecuta por separado (subagent-driven), como Fases 1–2.
- **Corte del flujo de adjuntos** (frontend→motor): fuera de alcance de Fase 3 (queda listo tras flag), para no arriesgar la operación.
