# Unificación de generación de PDF y Excel por tipo de documento — Diseño

> Spec de arquitectura. Fase 3 del Motor de Plantillas (`src/documents/`). Objetivo: que cada **tipo lógico de documento** (Salida a Ruta, Desembarque, Inventario, Cierre de Ruta, Devoluciones, reportes) tenga **una sola plantilla** usada en **todo** call-site que lo genere, con el **diseño rico canónico** y **conservando el diseño actual** para evitar regresiones visuales.
>
> Contrato de fidelidad: `docs/superpowers/references/document-inventory.md` (31 documentos catalogados columna a columna). Esta spec NO lo reemplaza; lo consume como fuente de verdad de cada diseño.

Fecha: 2026-07-18 · Branch: `feat/template-engine-phase3`

---

## 1. Contexto y estado actual

El Motor de Plantillas ya está construido y probado como patrón:

- `TemplateService.render(code, data)` carga la versión publicada, resuelve `{{variables}}` (Handlebars) + branding global, despacha por formato vía `RendererRegistry`, y **nunca lanza** (fallback).
- **PDF**: `PdfDoc` (bloques) → `PdfHtmlComposer` (→HTML branded) → `HtmlToPdfService` (playwright-core Chromium) → `PdfRenderer`. Referencia sembrada: `warehouse_dispatch_pdf` (B1). `warehouse.service.generatePdfBuffer` lo usa con **fallback a pdfmake legacy**.
- **Excel**: `ExcelDoc` (una tabla por hoja) → `ExcelWorkbookBuilder` (exceljs) → `ExcelRenderer`. Referencia sembrada: `audit_log_excel` (B9). `audit.controller.exportExcel` lo usa con fallback legacy.

**Limitaciones del schema actual** (bloqueantes para los diseños ricos):

- `PdfDoc` (bloques `heading/paragraph/symbology/infoGrid(4col)/statBoxes/table única/signatures/footer`, coloreo de fila `pago`/`vencehoy`, columnas ocultables): **no** soporta logo/imagen, fila de N métricas, badges por celda (C/$/H), separadores de zona por CP, tablas inválidos/faltantes/sobrantes, **layout de 2 columnas** (Cierre de Ruta), relleno hasta N filas.
- `ExcelDoc` (**una sola tabla por hoja**): **no** soporta múltiples secciones por hoja (Cierre = 6), **columnas dinámicas por día** (Estado de Resultados), **semáforo/colorScale condicional** (Choferes), estadísticas.

## 2. Decisiones de diseño (aprobadas)

1. **Plantilla única por tipo lógico**, diseño **rico (frontend) canónico**. El backend adopta la versión rica y deja de mantener las versiones simples duplicadas.
2. **Representación híbrida**:
   - **PDF** → plantilla **HTML-Handlebars** fiel al diseño; el composer solo aplica branding y Chromium imprime.
   - **Excel** → **`ExcelDoc` extendido** (secciones múltiples, columnas dinámicas, estilo condicional). NO se genera Excel vía HTML (exceljs da control muy superior de anchos/numFmt/fills).
3. **Organización por tipo de documento** (PDF+Excel juntos por tipo), plan completo primero.
4. **La plantilla controla PRESENTACIÓN**; DATOS y lógica (agregaciones, semáforos, columnas dinámicas, métricas) quedan **en código** (data-providers).
5. **No se borran** los generadores del frontend ni los métodos legacy del backend: quedan como **respaldo**. El corte del flujo de adjuntos (frontend→backend) va **detrás de un flag por tipo**, activado tras verificar paridad.

## 3. Mapa de unificación (tipo lógico → plantilla → call-sites)

| Tipo lógico | PDF | Excel | Fuente canónica | Reemplaza / call-sites | Estado |
|---|---|---|---|---|---|
| Salida a Ruta | `route_dispatch_pdf` | `route_dispatch_excel` | C1/C2 (rico) | frontend `package-dispatchs/upload` **+** `warehouse.service` título "Salida a Ruta" | pendiente |
| Desembarque | `unloading_pdf` | `unloading_excel` | C3/C4 | frontend `unloadings/upload` | pendiente |
| Inventario | `inventory_pdf` | `inventory_excel` | C5/C6 | frontend `inventories/upload` | pendiente |
| Cierre de Ruta | `route_closure_pdf` | `route_closure_excel` | C7/C8 | frontend `route-closure/upload` | pendiente |
| Devoluciones y Recolecciones | `returning_pdf` | `returning_excel` | C9/C10 | frontend `devolutions/upload` | pendiente |
| Entrada a Bodega / Traspaso | `warehouse_dispatch_pdf` ✅ | `warehouse_dispatch_excel` | B1/B2 | `warehouse.service` (títulos no-ruta) | PDF hecho; Excel pendiente |
| Reporte de Choferes | — | `driver_report_excel` | B3 | `GET /monitoring/report/drivers` | pendiente (semáforo) |
| Estado de Resultados | — | `income_statement_excel` | B4 | `resports.controller` | pendiente (cols dinámicas) |
| Inventario sin 67 | — | `inventory_no67_excel` | B5 | `GET /monitoring/inventory-67/:id/excel` | pendiente (3 hojas) |
| Shipments sin 67 | — | `shipments_no67_excel` | B6 | `shipments.controller` | pendiente (2 hojas + semáforo) |
| Recibidas con 67 | — | `received_67_excel` | B7 | `shipments.controller` | pendiente |
| Pendientes | — | `pending_shipments_excel` | B8 | `shipments.controller` | pendiente |
| Auditoría | — | `audit_log_excel` ✅ | B9 | `audit.controller` | HECHO |

**Salida a Ruta — data compartida:** las métricas ricas (F2/31.5, alto valor, con cobro, monto total, FedEx/DHL, vencen hoy, trackings inválidos) se derivan del arreglo `packages[]` que **ambos** call-sites poseen. Un único data-provider `route-dispatch.data` (packages+header+config-sucursal → `data`) sirve tanto a `warehouse.service` (cuando el título es "Salida a Ruta") como al flujo de package-dispatch. Entrada a Bodega / Traspaso permanecen en `warehouse_dispatch`.

## 4. Arquitectura

### 4.1 Data-providers (portar lógica del frontend)

Función/servicio **puro y testeable** por tipo, que mapea objetos de dominio → el objeto `data` que consume la plantilla: filas de tabla (vía un helper compartido `mapPackageInfo` espejo de `mapToPackageInfo` del frontend) + métricas agregadas + listas de secciones (inválidos/faltantes/sobrantes/DEX/cobros/recolecciones/…). Es donde vive el grueso del trabajo nuevo.

- **Ubicación:** co-localizados por módulo, espejo del frontend: `src/<modulo>/documents/<tipo>.data.ts` (p.ej. `src/package-dispatch/documents/route-dispatch.data.ts`, `src/unloading/documents/unloading.data.ts`).
- **Helper compartido:** `src/documents/data/package-info.ts` con el mapeo común de paquete → fila y utilidades de formato (fecha `America/Hermosillo`, cobro `${type} $${amount}`, badges C/$/H).
- **Contrato:** un data-provider recibe datos ya obtenidos por el servicio de dominio (no hace queries nuevas salvo config de sucursal) y devuelve `{ data }` listo para `render`.

### 4.2 Extensión PDF: variante HTML-Handlebars

`PdfDoc` gana campo opcional:

```ts
export interface PdfDoc {
  page: PdfPage;
  header?: { title: string; showDateTime?: boolean };
  html?: string;      // NUEVO: plantilla Handlebars completa (fiel al diseño). Si existe, gana.
  blocks?: PdfBlock[]; // legacy (retrocompatible)
}
```

- `PdfHtmlComposer.compose(doc)`: si `doc.html` está presente, envuelve con `<style>` de branding + `@page` y **retorna el HTML tal cual** (deja `{{var}}`/`{{brand.*}}` intactos para el TemplateEngine). Si no, ruta de bloques actual (sin cambios).
- **Branding en HTML crudo:** se exponen placeholders `{{brand.colors.*}}`, `{{brand.typography.fontFamily}}`, `{{brand.logoUrl}}`. El logo se resuelve a **data-URI** (o ruta local absoluta legible por Chromium) para que embeba sin red.
- **Fidelidad:** cada HTML se transcribe del generador `@react-pdf` correspondiente (estilos inline → CSS), conservando anchos, colores y reglas del inventario. Multipágina vía `thead` repetido / `@page`.

### 4.3 Extensión Excel: `ExcelDoc` con secciones

Retrocompatible (una tabla actual = una sección):

```ts
export interface ExcelSection {
  title?: string; titleFill?: string;
  infoRows?: { label: string; value: string }[];
  headerFill?: string; headerFont?: { bold?: boolean; color?: string };
  columns: ExcelColumn[] | { fromVar: string }; // fromVar: columnas dinámicas (p.ej. dateKeys)
  rowsVar?: string;
  totalsRow?: { label: string; fromVar?: string; fill?: string }; // fila de totales agregados
  freezeHeader?: boolean; autoFilter?: boolean;
  altFill?: string;            // filas alternas
}
export interface ExcelSheet {
  name: string;
  sections?: ExcelSection[];   // NUEVO. Si falta, se usa la forma de tabla única actual.
  // ...campos actuales (retrocompat)
}
```

- **Columnas dinámicas:** `columns: { fromVar: 'dateKeys' }` → el builder resuelve la lista de columnas desde `ctx.data.dateKeys` (Estado de Resultados: una columna por día del rango).
- **Estilo condicional / semáforo:** el **data-provider precomputa** una clase semántica por fila/celda (`_effClass: 'good'|'warn'|'bad'`, `_rowFill`, etc.); la sección mapea `clase → fill` vía `ExcelColumn.styleFromKey` + `styleMap`. Mantiene la lógica en código y la presentación en la plantilla.
- Filas alternas, fills por sección, merges, freeze/autoFilter por sección. Se conserva la regla del builder actual: **formato de columna antes de las filas** (los setters de columna de exceljs pisan estilos de filas existentes).

### 4.4 Integración + fallback (por call-site)

Patrón uniforme en cada servicio/controlador:

```ts
const buf = await this.templates.renderToBuffer(code, data).catch(() => null)
          ?? this.legacyGenerate(...);   // método legacy conservado como respaldo
```

- **Docs backend** (warehouse, monitoring, resports, shipments, audit): el método legacy queda intacto como fallback.
- **Docs que nacen en el frontend** (route-dispatch, unloading, inventory, route-closure, returning): se construye la generación en backend; el generador del frontend se **conserva**; el corte del flujo de adjuntos (dejar de subir desde el frontend y adjuntar desde el motor) va **detrás de un flag por tipo** (`DOC_ENGINE_<TYPE>`), activado sólo tras verificar paridad visual.

## 5. Secuencia de lotes (cada lote: data-provider + plantilla(s) + seed + integración + tests)

1. **Salida a Ruta** — pattern-setter. Introduce la variante HTML-PDF y las secciones Excel. Unifica warehouse (título "Salida a Ruta") + frontend `package-dispatchs/upload`. Data-provider compartido desde `packages[]`.
2. **Desembarque** — `unloading_pdf` + `unloading_excel` (secciones faltantes/sobrantes).
3. **Inventario** — `inventory_pdf` (portrait, badges, faltantes/sin-escaneo, firmas) + `inventory_excel`.
4. **Cierre de Ruta** — el más complejo: PDF **2 columnas** (devueltos/no-van/DEX vs desglose/recolecciones/cobros/stats) + Excel **6 secciones**. Valida definitivamente el enfoque HTML + secciones.
5. **Devoluciones y Recolecciones** — `returning_pdf` (A4, tablas espejo devolución/recolección, DEX) + `returning_excel`.
6. **Warehouse Entrada/Traspaso Excel** — `warehouse_dispatch_excel` (B2). (PDF B1 ya hecho.)
7. **Reporte de Choferes** — `driver_report_excel` (2 hojas, **semáforo** → estilo condicional del §4.3).
8. **Estado de Resultados** — `income_statement_excel` (3 hojas, **columnas dinámicas por día** → §4.3).
9. **Inventario sin 67** — `inventory_no67_excel` (3 hojas: resumen/detalles/estadísticas).
10. **Shipments sin 67** — `shipments_no67_excel` (2 hojas + semáforo por días).
11. **Recibidas con 67** — `received_67_excel` (1 hoja).
12. **Pendientes** — `pending_shipments_excel` (1 hoja, frozen).

Extensiones de schema por lote: **1** (secciones Excel + HTML-PDF), **7** (estilo condicional), **8** (columnas dinámicas). El resto reutiliza.

## 6. Estrategia de pruebas

- **Data-providers:** unit tests puros — objeto de dominio de entrada → objeto `data` esperado (filas, métricas, secciones). TDD.
- **Excel:** unit-testable sin navegador — cargar el buffer con exceljs y **assertar valores, numFmt, fills, merges, freeze, autoFilter, estructura de secciones**. TDD.
- **PDF:** el HTML compuesto es testeable por estructura/branding (assert de columnas, colores, reglas condicionales presentes). **Fidelidad visual sólo verificable con Chromium**; snapshot del HTML compuesto como red de seguridad. Referencia dorada: salida legacy/frontend.
- **Regresión:** los seeds existentes (`warehouse_dispatch_pdf`, `audit_log_excel`, 12 correos) deben seguir pasando tras las extensiones retrocompatibles.

## 7. No-objetivos / riesgos / mitigaciones

- **No** se borran generadores del frontend ni métodos legacy (respaldo).
- **Corte de adjuntos** frontend→backend: flag-gated por tipo; fuera de alcance activarlo sin verificación de paridad.
- **Chromium**: la fidelidad PDF sólo se garantiza con Chromium instalado (`CHROMIUM_PATH`/`channel:'chrome'`). Sin él → fallback legacy (pdfmake backend donde aplique; o seguir subiendo desde el frontend). Riesgo aceptado y ya presente en B1.
- **Salida a Ruta / warehouse**: se verifica en el lote 1 que el call-site de warehouse dispone de `packages[]` con los campos que el data-provider necesita; si falta algún campo, se documenta el degradado (métrica en 0) sin romper.
- **Multi-tenant / i18n**: columnas presentes pero lógica single-tenant/`es` (igual que Fase 1).

## 8. Entregables por lote

Cada lote produce: (a) data-provider(s) + tests; (b) plantilla(s) HTML/ExcelDoc + seed idempotente; (c) extensión de schema si aplica + tests; (d) integración en el/los call-site(s) con fallback; (e) actualización de `graphify update .`. El branch permanece `feat/template-engine-phase3` (no mergear hasta decisión del usuario).
