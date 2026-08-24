# Welcome-dashboard: multi-sucursal, página completa, Excel y comprobación FedEx

Fecha: 2026-08-23
Rama: `feat/fedex-paste-approvals-imports`
Repos: `pmy-api` (backend), `app-pmy` (frontend)

## Objetivo

Permitir que **superadmin** y los usuarios/roles con **más de una sucursal** vean y
cambien de sucursal en el welcome-dashboard; agregar un botón para verlo en **página
completa**, **exportar a Excel** esos datos y **comprobarlos contra FedEx**.

## Decisiones (confirmadas con el usuario)

- **Comprobar FedEx**: re-verificación *batch* read-only + marcar diferencias (no persiste).
- **Página completa**: nueva ruta que reutiliza el componente (no duplicar markup).
- **Selector de sucursal**: permitidas + opción "Todas" (globales ven todas).
- **Excel**: resumen (KPIs) + 3 hojas de detalle (Vencen hoy, Sin escaneo, Pendientes),
  con la sucursal en cada fila.

## Backend (`pmy-api`)

### 1. `GET /dashboard/welcome` — scoping por rol + multi-sucursal
Hoy confía en `subsidiaryId` sin validar rol. Cambios:
- Firma → `subsidiaryIds?` (comma-separated, `ParseArrayPipe`) + `@Req()`.
- Scoping (espejo de `subsidiary-metrics`): roles globales (`superadmin/superamin/owner`)
  ven todas; no-globales → intersección con `req.user.subsidiaryIds` (main + adicionales);
  sin param: globales = todas, no-globales = todo su set permitido; sin sucursal → vacío.
- `KpiService.getWelcomeDashboard(subsidiaryIds?: string[])` usa `In(...)` en `subFilter`.

### 2. `POST /dashboard/welcome/verify-fedex` (nuevo, read-only)
- Body `{ trackingNumbers: string[] }` (cap 200, dedup).
- Usa `FedexStatusResolver.getLatestStatusBatch`.
- Devuelve por guía `{ trackingNumber, found, status, description, lastEvent, fetchedAt, error? }`.
- `DashboardModule` importa `FedexStatusModule` (que exporta el resolver).

## Frontend (`app-pmy`)

### 3. Servicios (`lib/services/dashboard.ts`)
- `getWelcomeDashboard(subsidiaryIds?: string[])` → query `subsidiaryIds` (join ",").
- `verifyWelcomeFedex(trackingNumbers: string[])` → POST verify-fedex.

### 4. Refactor a hook + vista compartida
- `useWelcomeDashboard(subsidiaryIds)` — fetch + construcción de `feed` + `stats`.
- `WelcomeDashboardView` — presentacional (hero, KPIs, feed, toolbar). Recibe `variant`
  (`"dialog" | "page"`). Toolbar: selector de sucursal, "Comprobar FedEx", "Exportar Excel".
- `DashboardWelcome` (diálogo) envuelve la vista en `Dialog` + botón "Ver completo".
- Nueva página `app/operaciones/resumen-operativo/page.tsx` → `AppLayout` +
  `OperationHeader` + `withAuth(Component)` (cualquier autenticado), envuelve la vista.

### 5. Selector de sucursal
- Reusa `SucursalSelector` (ya scopea a permitidas/global) + opción "Todas".
- Se muestra solo si el usuario tiene >1 sucursal accesible o es global.
- Estado `selectedSubsidiaryIds: string[]` (vacío = Todas) → hook → servicio.

### 6. Comprobar FedEx (batch)
- Botón toma los `trackingNumber` del feed visible (cap 200), llama `verifyWelcomeFedex`.
- Muestra badge por fila con el estatus fresco de FedEx y marca diferencias; resumen
  "X verificados, Y con diferencia". Estado de carga.

### 7. Excel (`lib/services/dashboard/export-welcome-to-excel.ts`)
- ExcelJS + file-saver (patrón `export-devolution-to-excel`).
- Hoja "Resumen" (KPIs) + "Vencen hoy" / "Sin escaneo" / "Pendientes" con sucursal por fila.

## No-objetivos / YAGNI
- No persistir estatus FedEx (solo comparar).
- No paginación server-side nueva (se mantiene el cap actual de listas).
- No refactor no relacionado del `kpi.service`.

## Casas de la casa (app-pmy)
Toda pantalla dentro de `AppLayout` + `withAuth` + `OperationHeader`, solo shadcn + Tailwind.
