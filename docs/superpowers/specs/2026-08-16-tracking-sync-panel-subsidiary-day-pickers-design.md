# Panel de Sincronización — Selección por Sucursal + Día — Diseño

**Fecha:** 2026-08-16
**Estado:** Aprobado para plan de implementación
**Repo:** `app-pmy` (frontend-only). Sin cambios de backend.
**Depende de:** panel experimental ya en `main` (`app/dev/tracking-sync/`, `components/tracking-sync/compare-table.tsx`, `lib/services/tracking-sync.ts`).

## 1. Objetivo

En los modos batch del panel (salida a ruta y consolidado), reemplazar el input de ID a mano por una selección guiada: **Sucursal + Día → lista → elegir**. Ataca la usabilidad: el operador no conoce los IDs; sí conoce su sucursal y la fecha.

## 2. Decisiones acordadas

- **Modos:** "Por guía" (sin cambios, input de tracking), "Por salida a ruta", "Por consolidado". Devolución queda cubierta dentro de consolidado (sus guías pertenecen a un consolidatedId).
- **Fecha:** un solo día.
- **Backend:** ninguno — se reutilizan endpoints existentes de listado y de compare.

## 3. Endpoints reutilizados (ya existen)

- Sucursales: `GET subsidiaries` → `getSubsidiaries()`.
- Rutas: `GET package-dispatch/subsidiary/:subsidiaryId?from&to` → `getPackageDispatchs(subsidiaryId, { from, to })` (paginado).
- Consolidados: `GET consolidated?subsidiaryId&fromDate&toDate`.
- Compare: `compareByRoute(id)`, `compareByConsolidated(id)` (sin cambios).

## 4. Diseño (frontend)

### 4.1 Servicios (`lib/services/tracking-sync.ts`)
Dos helpers que devuelven opciones ya normalizadas para el desplegable:

```ts
export interface PickerOption { id: string; label: string; }
export const listRoutesBySubsidiaryDay = (subsidiaryId: string, day: string): Promise<PickerOption[]>;
export const listConsolidatedsBySubsidiaryDay = (subsidiaryId: string, day: string): Promise<PickerOption[]>;
```
- `listRoutesBySubsidiaryDay`: llama `package-dispatch/subsidiary/:id?from=day&to=day`, mapea cada ruta a `{ id, label }`.
- `listConsolidatedsBySubsidiaryDay`: llama `consolidated?subsidiaryId=id&fromDate=day&toDate=day`, mapea cada consolidado a `{ id, label }`.

### 4.2 Helper puro (`lib/tracking/picker-options.ts`) — testeable con Vitest
`buildRouteOption(route)` y `buildConsolidatedOption(cons)` arman la etiqueta legible desde los campos disponibles, tolerando campos faltantes:
- Ruta → `label = "<fecha corta> · <#guías> guías · <chofer|—>"` (o el id corto si no hay más).
- Consolidado → `label = "<fecha corta> · <nombre|id corto> · <#guías>"`.
La normalización de fecha (`YYYY-MM-DD`) también vive aquí (`toDayRange(day) → { from, to }`), testeada.

### 4.3 Página (`app/dev/tracking-sync/page.tsx`)
- Estado: `mode`, `subsidiaryId`, `day`, `options: PickerOption[]`, `selectedId`, más los ya existentes.
- Para modos ruta/consolidado renderiza: `[Sucursal ▼]` (de `getSubsidiaries()`, superadmin ve todas) + `[Fecha]` (input date, default hoy) + botón **"Buscar"**.
  - "Buscar" llama al helper de servicio correspondiente y llena `options`.
  - Un `<select>` de `options`; al elegir, dispara `compareByRoute(id)` / `compareByConsolidated(id)` y muestra `<CompareTable>`.
- Modo "Por guía": sin cambios.
- Estados: loading de la lista, "sin resultados para esa sucursal/día", error.

## 5. Testing
- Vitest de `picker-options.ts`: `buildRouteOption`/`buildConsolidatedOption` con campos completos y faltantes; `toDayRange` genera `{ from, to }` correctos para un día.
- Sin `next dev` (RAM). Verificación con Vitest + `tsc --noEmit`.

## 6. Fuera de alcance
- Backend (nada). Rango de fechas (solo día). Modo dedicado de devolución.
