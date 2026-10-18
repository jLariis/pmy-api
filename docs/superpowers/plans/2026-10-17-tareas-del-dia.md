# Tareas del día — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla "Tareas del día" (por sucursal, semana lun–dom) con checklist automático por consolidado y por sucursal, detalle de paquetes, posibles LD y avisos por app/correo/WhatsApp, con horarios configurables por sucursal.

**Architecture:** Módulo nuevo `src/daily-tasks` en pmy-api que calcula los pasos con funciones puras (horarios resueltos por sucursal), guarda el estado en `daily_task` y dispara avisos sobre el motor existente de `ops-alerts` (`ops_alert`, `SendLogService`, `NotificationDispatchService`). La regla de LD se unifica en `src/common/ld-rule.util.ts`. En app-pmy, página `app/operaciones/tareas-del-dia` solo con shadcn + Tailwind.

**Tech Stack:** NestJS + TypeORM (MySQL), Jest · Next.js + shadcn/ui + Tailwind + SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-tareas-del-dia-design.md`

## Global Constraints

- Zona horaria de negocio: `America/Hermosillo` (UTC−7); "día" = día local de Hermosillo.
- Semana lunes a domingo (`app-pmy/lib/week.ts` `getWeekRange`, `pmy-api` `pagination.util.ts`).
- Esquema SOLO por migración (DB_SYNC=false); migraciones defensivas con guard a `information_schema`, numeración `1786000000109`+.
- Checklist de solo lectura: ningún endpoint permite marcar/desmarcar pasos.
- Horario activo de avisos 06:00–21:30 (`OpsAlertSettings.activeFrom/activeTo`); nunca avisar fuera.
- Predefinidos por sucursal: subir 30 min · desembarque 21:00 · salida 120 min tras desembarque (respaldo 10:00 día siguiente si cae después de 21:30) · cierre 21:00 · inventario inicial 10:00 · devoluciones 19:30 · inventario final 20:00 (aviso previo 19:00).
- Canales: campana = atraso y completado; correo = resumen 19:00; WhatsApp = solo atrasos importantes (nivel ≥ `alertGroupsLevel` e inventario final a las 20:00).
- Permiso nuevo `operaciones.tareas` (roles `OPERATIVE`); datos acotados a sucursales visibles del usuario.
- UI: dentro de `AppLayout` + `withAuth` + `OperationHeader`; solo `@/components/ui/*` + Tailwind; densa; textos en llano (sin tecnicismos); acciones fuertes en el header.
- Al tocar un archivo, resolver todos los errores de tsc/lint/tests que salgan en él.
- Tras cambios de código: `graphify update .`.

## Review Focus

- Consolidado que vino por correo: no debe recibir el mismo aviso dos veces (ops-alerts de bandeja + tareas). → test en Task 6.
- Desembarque tarde (21:00 o después): la salida a ruta vence a las 10:00 del día siguiente, no a las 23:00. → test en Task 2.
- Guía que se movió de ruta / se reintentó: "cierre de rutas" cuenta por salida (`package_dispatch_history`), no por la FK viva. → test en Task 3.
- Devolución deshecha (`undoneAt`) no cuenta como devolución registrada. → test en Task 3.
- Posibles LD de hoy deben coincidir con el reporte "Inventario sin movimiento (LD)" para el mismo día y sucursal. → test en Task 1.

---

### Task 1: Regla única de LD

**Files:**
- Create: `src/common/ld-rule.util.ts`
- Test: `src/common/ld-rule.util.spec.ts`
- Modify: `src/inventories/inventories.service.ts` (~1860-1875), `src/package-dispatch/package-dispatch.service.ts` (~2820-2830), `src/shipments/shipments.service.ts` (~4945-4958)

**Interfaces:**
- Produces:
  ```ts
  export type LdInput = { status: string; commitDay: string | null; today: string; dexDays: Set<string> | undefined; movedDays: Set<string> | undefined; requireNoMovement: boolean };
  export type LdState = 'delivered' | 'closed' | 'ld' | 'possible_ld' | 'active';
  export function classifyLd(i: LdInput): LdState;
  export function herDay(x: Date | string): string; // YYYY-MM-DD Hermosillo
  ```
  `possible_ld` = vence HOY, no entregado/cerrado, sin DEX válido ni movimiento hoy. `ld` = vencido (commitDay < today) con las mismas condiciones en su día de vencimiento. `requireNoMovement=false` reproduce la variante de salidas a ruta (no exige "sin movimiento").

- [ ] **Step 1: Write the failing tests**
  - `vence hoy sin DEX ni movimiento → possible_ld`
  - `vence hoy con DEX 08 hoy → active`
  - `vencido ayer sin movimiento ayer → ld`
  - `entregado_en_bodega → delivered`; `devuelto_a_fedex → closed`
  - `requireNoMovement=false: vence hoy con movimiento pero sin DEX → possible_ld`
  - `commitDay null → active`
- [ ] **Step 2:** `npx jest src/common/ld-rule.util.spec.ts` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar `classifyLd` y `herDay` (DELIVERED = entregado/entregado_por_fedex/entregado_en_bodega; CLOSED = `TERMINAL_SHIPMENT_STATUSES` menos entregados).
- [ ] **Step 4:** `npx jest src/common/ld-rule.util.spec.ts` → PASS.
- [ ] **Step 5:** Reemplazar los 3 cálculos `isLD` por `classifyLd` (inventories y shipments con `requireNoMovement: true`, package-dispatch con `false`). Correr `npx jest src/inventories src/package-dispatch src/shipments` → PASS; `npx tsc --noEmit -p tsconfig.json` sin errores en esos archivos.
- [ ] **Step 6: Commit** `refactor(ld): una sola regla de LD para reportes y tareas`

### Task 2: Horarios por sucursal y cálculo de pasos (puro)

**Files:**
- Create: `src/daily-tasks/daily-task-schedule.util.ts`, `src/daily-tasks/daily-task-steps.util.ts`, `src/daily-tasks/daily-task.types.ts`
- Test: `src/daily-tasks/daily-task-schedule.util.spec.ts`, `src/daily-tasks/daily-task-steps.util.spec.ts`

**Interfaces:**
- Consumes: `localDay`, `atLocalTime`, `addDays` de `src/ops-alerts/ops-alerts.util.ts`.
- Produces (`daily-task.types.ts`):
  ```ts
  export type TaskRefType = 'consolidated' | 'charge' | 'subsidiary';
  export type TaskStep = 'upload' | 'unloading' | 'dispatch' | 'closure' | 'devolutions' | 'inventory_initial' | 'inventory_final';
  export type TaskStatus = 'pending' | 'partial' | 'done' | 'late';
  export interface Schedule { uploadMinutes: number; unloadingTime: string; dispatchAfterUnloadMinutes: number; dispatchNextDayTime: string; closureTime: string; inventoryInitialTime: string; devolutionsTime: string; inventoryFinalTime: string; activeTo: string; completePct: number }
  export interface Progress { done: number; total: number; first: Date | null; last: Date | null; lastById?: string | null; lastByName?: string | null }
  export interface ConsolidatedFacts { refType: 'consolidated' | 'charge'; refId: string; consNumber: string; day: string; uploadedAt: Date; uploadedById: string | null; uploadedByName: string | null; unloading: Progress; dispatch: Progress; closure: Progress; devolutions: Progress }
  export interface SubsidiaryDayFacts { day: string; inventoryInitialAt: Date | null; inventoryFinalAt: Date | null; inventoryInitialBy: string | null; inventoryFinalBy: string | null; dispatchesTotal: number; dispatchesClosed: number; lastClosureAt: Date | null; dexTotal: number; dexWithDevolution: number; lastDevolutionAt: Date | null }
  export interface TaskRow { refType: TaskRefType; refId: string; consNumber: string | null; step: TaskStep; status: TaskStatus; doneCount: number; totalCount: number; dueAt: Date; doneAt: Date | null; doneById: string | null; doneByName: string | null }
  ```
- Produces (utils):
  ```ts
  export const DEFAULT_SCHEDULE: Omit<Schedule, 'activeTo' | 'completePct'>;
  export function resolveSchedule(global: OpsSettings, sub: Partial<Schedule> | null): Schedule;
  export function consolidatedTasks(f: ConsolidatedFacts, s: Schedule, now: Date): TaskRow[];
  export function subsidiaryTasks(subsidiaryId: string, f: SubsidiaryDayFacts, s: Schedule, now: Date): TaskRow[];
  ```

- [ ] **Step 1: Write the failing tests**
  - `resolveSchedule(null)` → valores de Global Constraints; columna de sucursal no nula gana; columna nula usa global.
  - `dispatch`: desembarque listo 08:00 → `dueAt` 10:00 mismo día; desembarque listo 20:30 → `dueAt` 10:00 del día siguiente (Review Focus).
  - `unloading`: 121/124 a las 15:00 → `partial`; a las 21:05 → `late`; 124/124 → `done` con `doneAt = last`.
  - Un paso no se vuelve `late` si el anterior no está `done` (queda `pending`).
  - `subsidiaryTasks`: sin inventario final a las 20:01 → `inventory_final` `late`; 4/6 rutas cerradas → `closure` `partial`; `dexTotal=0` → `devolutions` `done`.
- [ ] **Step 2:** `npx jest src/daily-tasks` → FAIL.
- [ ] **Step 3:** Implementar. Estado: `done` si `total>0 && pct>=completePct` (o condición booleana del paso); `late` si no `done` y `now > dueAt`; `partial` si `done>0`; si no `pending`.
- [ ] **Step 4:** `npx jest src/daily-tasks` → PASS.
- [ ] **Step 5: Commit** `feat(tareas): horarios por sucursal y cálculo de pasos`

### Task 3: Migración, entidades y lectura de hechos (SQL)

**Files:**
- Create: `src/database/migrations/1786000000109-DailyTasks.ts`, `src/entities/daily-task.entity.ts`, `src/entities/daily-ld.entity.ts`, `src/daily-tasks/daily-task-facts.service.ts`, `src/daily-tasks/package-summary.util.ts`
- Modify: `src/entities/ops-alert.entity.ts` (columnas nuevas), `src/auth/rbac/permission-catalog.ts` (agregar `{ code: 'operaciones.tareas', name: 'Tareas del día', groupName: 'Operaciones', roles: OPERATIVE }`)
- Test: `src/daily-tasks/package-summary.util.spec.ts`, `src/daily-tasks/daily-task-facts.service.spec.ts` (DB local)

**Interfaces:**
- Produces:
  - Tabla `daily_task` (columnas del spec §3; `UQ_daily_task` en `subsidiaryId, day, refType, refId, step`; índice `subsidiaryId, day`).
  - Tabla `daily_ld` (`id`, `subsidiaryId`, `day` date, `trackingNumber`, `shipmentId` null, `chargeShipmentId` null, `consNumber`, `status`, `createdAt`; UQ `subsidiaryId, day, trackingNumber`).
  - `ops_alert`: `consolidatedId varchar(36) NULL`, `chargeId varchar(36) NULL`; `step` ampliar a `varchar(20)`.
  - `ops_alert_subsidiary`: `stepDevolutions`, `stepInventoryInitial` (bool default 1) y `uploadMinutes int`, `unloadingTime`, `dispatchAfterUnloadMinutes int`, `dispatchNextDayTime`, `closureTime`, `inventoryInitialTime`, `devolutionsTime`, `inventoryFinalTime` (varchar(5)); la migración inserta una fila por sucursal activa que no tenga y llena los predefinidos.
  - Permiso `operaciones.tareas` sembrado como en `1786000000096-CorreosPermissions.ts`.
  - ```ts
    export type PackageSummary = { delivered: number; inRoute: number; dex: Record<string, number>; returned: number; inWarehouse: number; inInventory: number; possibleLd: number; missingUnloading: number };
    export function summarizePackages(rows: { status: string; exceptionCode: string | null; unloaded: boolean; inTodayInventory: boolean; ld: LdState }[]): PackageSummary;
    class DailyTaskFactsService {
      consolidatedFacts(subsidiaryId: string, day: string): Promise<ConsolidatedFacts[]>;
      subsidiaryFacts(subsidiaryId: string, day: string): Promise<SubsidiaryDayFacts>;
      packageDetail(refType: 'consolidated'|'charge', refId: string, today: string): Promise<{ summary: PackageSummary; guides: { trackingNumber: string; status: string; bucket: string; ld: LdState }[] }>;
    }
    ```
  Consultas agrupadas por lote (patrón de `LifecycleService.aggregate`), por `id` de `consolidated`/`charge` con `consolidated.active = 1`; día de consolidado = `consolidated.date` / `charge.date` tal cual (medianoche local guardada como 00:00Z). Despacho y cierre vía `package_dispatch_history` + `route_closure.package_dispatch_id`. Devoluciones: guías DEX del consolidado vs `devolution` con `undoneAt IS NULL` o que volvieron a salir a ruta después del DEX. Inventarios por `type` (`initial`/`final`) y `inventoryDate` del día.

- [ ] **Step 1:** Tests de `summarizePackages` (DEX agrupado por código `03/07/08`, `possible_ld` contado, devuelto_a_fedex → `returned`).
- [ ] **Step 2:** `npx jest src/daily-tasks/package-summary` → FAIL; implementar; → PASS.
- [ ] **Step 3:** Escribir migración + entidades; `npm run migration:run` en local → aplica sin error; correrla 2 veces no falla (guards).
- [ ] **Step 4:** Test de integración `daily-task-facts.service.spec.ts` contra la BD local (patrón de los specs existentes que usan `DataSource` local; `describe.skip` si no hay `DB_HOST`):
  - guía movida a otra ruta cuenta en `dispatch` y en `closure` según historial (Review Focus);
  - devolución con `undoneAt` no suma a `dexWithDevolution` (Review Focus);
  - `possibleLd` del consolidado = guías `possible_ld` de `getInventoryLDReport` filtrando el mismo día (Review Focus).
- [ ] **Step 5:** `npx jest src/daily-tasks` → PASS.
- [ ] **Step 6: Commit** `feat(tareas): tablas daily_task/daily_ld, horarios por sucursal y lectura de hechos`

### Task 4: Servicio de tareas y transiciones

**Files:**
- Create: `src/daily-tasks/daily-tasks.service.ts`, `src/daily-tasks/daily-task-diff.util.ts`, `src/daily-tasks/daily-tasks.module.ts`
- Modify: `src/app.module.ts` (registrar `DailyTasksModule`)
- Test: `src/daily-tasks/daily-task-diff.util.spec.ts`

**Interfaces:**
- Consumes: Task 2 utils, Task 3 `DailyTaskFactsService`, `OpsAlertsService.getSettings()`.
- Produces:
  ```ts
  export type Transition = { row: TaskRow; from: TaskStatus | null; to: TaskStatus };
  export function diffTasks(prev: TaskRow[], next: TaskRow[]): Transition[]; // solo cambios reales; nueva fila 'pending' no es transición
  class DailyTasksService {
    refreshDay(subsidiaryId: string, day: string, now?: Date): Promise<Transition[]>; // calcula, upsert daily_task, devuelve transiciones
    refreshOpenDays(now?: Date): Promise<Transition[]>; // semana actual hasta hoy, sucursales activas
    week(subsidiaryId: string, weekStart: string): Promise<{ days: { day: string; pct: number; late: number; done: number; total: number }[] }>;
    day(subsidiaryId: string, day: string): Promise<{ subsidiary: TaskRow[]; consolidated: { refType; refId; consNumber; carrier; type; guides: number; tasks: TaskRow[] }[]; carriedOver: { day: string; consNumber: string; refType; refId; lateSteps: TaskStep[] }[]; possibleLd: { trackingNumber: string; consNumber: string; bucket: string }[] }>;
    snapshotLd(subsidiaryId: string, day: string): Promise<number>;
  }
  ```
  `day()` lee de `daily_task` (y llama `refreshDay` si es hoy); `carriedOver` = consolidados de días anteriores de la misma semana con algún paso no `done`. Días pasados leen LD de `daily_ld`.

- [ ] **Step 1:** Tests de `diffTasks`: `pending→partial`, `partial→done`, `done→done` no emite, fila nueva `late` sí emite (`from: null`).
- [ ] **Step 2:** FAIL → implementar → `npx jest src/daily-tasks` PASS.
- [ ] **Step 3:** Implementar `DailyTasksService` y módulo (importa `OpsAlertsModule`, `TypeOrmModule.forFeature([DailyTask, DailyLd, OpsAlertSubsidiary])`).
- [ ] **Step 4:** `npx tsc --noEmit` sin errores; arrancar API local y en un script de humo (`scripts/smoke-daily-tasks.ts`, scratch, no se commitea) llamar `refreshDay('<Hermosillo>', '<hoy>')` → filas en `daily_task`.
- [ ] **Step 5: Commit** `feat(tareas): servicio de tareas del día con transiciones`

### Task 5: Endpoints

**Files:**
- Create: `src/daily-tasks/daily-tasks.controller.ts`
- Test: `src/daily-tasks/daily-tasks.controller.spec.ts`

**Interfaces:**
- `GET /daily-tasks/week?subsidiaryId&weekStart` → `week()`
- `GET /daily-tasks/day?subsidiaryId&day` → `day()`
- `GET /daily-tasks/detail/:refType/:refId` → `packageDetail()`
- `POST /daily-tasks/refresh?subsidiaryId&day` → `refreshDay()` (recalcula; no marca nada)
- Guard de permiso `operaciones.tareas` y alcance de sucursales igual que `ops-alerts.controller.ts` (`scope` del usuario); sucursal fuera de alcance → 403 con mensaje en español.

- [ ] **Step 1:** Test: usuario sin la sucursal en su alcance → `ForbiddenException`; `refType` inválido → `BadRequestException` "Tipo de consolidado no válido".
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3: Commit** `feat(tareas): endpoints de tareas del día`

### Task 6: Avisos (campana, correo, WhatsApp) y crons

**Files:**
- Create: `src/daily-tasks/daily-task-notify.util.ts`, `src/daily-tasks/daily-tasks.cron.ts`
- Modify: `src/notifications/notification-catalog.ts` (tipos nuevos), `src/ops-alerts/ops-alerts.service.ts` (`evaluate`: solo paso `upload` para bandeja; `evaluateInventory` se elimina), `src/daily-tasks/daily-tasks.service.ts`
- Test: `src/daily-tasks/daily-task-notify.util.spec.ts`

**Interfaces:**
- Catálogo:
  - `'tareas.paso_atrasado'`: `{ category: 'operacion', icon: 'alarm-clock', severity: 'warning', channels: ['bell'] }`
  - `'tareas.paso_completo'`: `{ category: 'operacion', icon: 'circle-check', severity: 'info', channels: ['bell'] }`
  - `'tareas.resumen_dia'`: `{ category: 'operacion', icon: 'list-checks', severity: 'info', channels: ['email'] }`
  - `'tareas.inventario_final_pendiente'`: `{ category: 'operacion', icon: 'clipboard-list', severity: 'warning', channels: ['bell'] }`
- ```ts
  export function transitionMessage(t: Transition, subsidiaryName: string): { type: string; title: string; body: string; link: string } | null;
  export function dayDigest(subsidiaryName: string, day: string, d: Awaited<ReturnType<DailyTasksService['day']>>): { subject: string; html: string; whatsapp: null };
  ```
  Textos en llano, ej. `"F2 4410 0921 sin salida a ruta"` / `"Desembarcado hace 2 h · Hermosillo"`; link `/operaciones/tareas-del-dia?sucursal=<id>&dia=<day>`.
- Escalamiento a WhatsApp: se registra en `ops_alert` con `refKey = dt:<refType>:<refId>:<step>` (o `dt:subsidiary:<subId>:<day>:<step>`) reutilizando `alertLevel` y `SendLogService.notifyUsers/whatsappTo`; WhatsApp solo si `level >= alertGroupsLevel`.
- Crons (`timeZone: 'America/Hermosillo'`): cada 5 min `refreshOpenDays` + avisos (respeta `enabled` y `inActiveHours`); `0 0 19 * * *` resumen por correo + campana "inventario final pendiente"; `0 0 20 * * *` WhatsApp si no hay inventario final; `0 30 20 * * *` `snapshotLd` de todas las sucursales.

- [ ] **Step 1:** Tests: `transitionMessage` de `partial→done` da `tareas.paso_completo`; de `pending→late` da `tareas.paso_atrasado`; `done→late` no existe (null); `dayDigest` lista "Falta: inventario final de día, 2 rutas sin cerrar, 9 DEX sin devolución".
- [ ] **Step 2:** Test (Review Focus): consolidado que vino por correo con atraso de desembarque genera UN solo registro en `ops_alert` (el `dt:`), y `OpsAlertsService.evaluate` ya no produce paso `unloading` para él.
- [ ] **Step 3:** FAIL → implementar → `npx jest src/daily-tasks src/ops-alerts src/notifications` PASS.
- [ ] **Step 4:** Con `devTestNumber` en local, forzar evaluación → WhatsApp redirigido al número de prueba; bitácora en `correo_send_log`.
- [ ] **Step 5: Commit** `feat(tareas): avisos por app, correo y WhatsApp`

### Task 7: Configuración de horarios por sucursal

**Files:**
- Modify: `src/ops-alerts/ops-alerts.service.ts` (`updateSubsidiaryConfig` valida `HHMM` y minutos 0–1440), `app-pmy/lib/services/ops-alerts.ts` (`OpsSubsidiaryConfig` + campos), `app-pmy/components/configuracion/ops-alerts-panel.tsx`
- Test: `src/ops-alerts/ops-alerts.util.spec.ts` (validación), `app-pmy/components/configuracion/ops-alerts-panel.test.tsx` si existe patrón; si no, test del helper de formato.

- [ ] **Step 1:** Test backend: `unloadingTime: '25:00'` → `BadRequestException` "Hora no válida (usa HH:MM)".
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** UI: en el diálogo de edición de cada sucursal, sección "Horarios de tareas" con un campo por horario (etiqueta flotante + ícono, 48 px), pasos activables nuevos (Devoluciones, Inventario inicial) y botón "Usar valores generales" que manda `null`. Validación campo por campo bajo el input.
- [ ] **Step 4:** `npm run build` en app-pmy sin errores de tipos; verificar en navegador (Configuración → Alertas → editar Hermosillo → guardar 19:45 en inventario final → recargar conserva).
- [ ] **Step 5: Commit** (ambos repos) `feat(tareas): horarios de tareas por sucursal`

### Task 8: Pantalla Tareas del día (app-pmy)

**Files:**
- Create: `app-pmy/app/operaciones/tareas-del-dia/page.tsx`, `app-pmy/lib/services/daily-tasks.ts`, `app-pmy/components/tareas-del-dia/{tareas-screen.tsx,week-strip.tsx,subsidiary-tasks.tsx,possible-ld-card.tsx,consolidated-row.tsx,package-cards.tsx,task-step.tsx}`, `app-pmy/lib/daily-tasks-view.ts`
- Modify: `app-pmy/lib/access/allowed-page-roles.ts` (`operaciones.tareas`), `app-pmy/lib/constants.ts` (menú Operaciones, ícono `ListChecks`, primero de la lista), `app-pmy/components/app-layout.tsx` (título `"/operaciones/tareas-del-dia": "Tareas del día"`)
- Test: `app-pmy/lib/daily-tasks-view.test.ts`

**Interfaces:**
- Consumes: endpoints de Task 5; `getWeekRange`, `shiftWeek`, `formatWeekLabel` de `lib/week.ts`; `sucursal-selector.tsx`.
- Produces (`lib/daily-tasks-view.ts`):
  ```ts
  export function stepVisual(status: TaskStatus): { icon: 'done' | 'partial' | 'pending' | 'late'; strike: boolean; tone: 'success' | 'warning' | 'muted' | 'danger' };
  export function stepLabel(step: TaskStep): string; // 'Consolidado subido','Desembarque','Salidas a ruta','Cierre de rutas','Devoluciones','Inventario inicial','Inventario final de día'
  export function stepLink(step: TaskStep): string; // pantalla donde se hace el paso
  export function sortConsolidated<T extends { tasks: { status: TaskStatus }[] }>(list: T[]): T[]; // con atrasos primero, terminados al final
  export function dayPct(tasks: { status: TaskStatus }[]): number;
  ```

- [ ] **Step 1:** Tests Vitest de `stepVisual`, `stepLabel`, `sortConsolidated` (terminados al final), `dayPct` (redondeo entero).
- [ ] **Step 2:** `npx vitest run lib/daily-tasks-view.test.ts` FAIL → implementar → PASS.
- [ ] **Step 3:** Página: `OperationHeader` con selector de sucursal (`w-56`), selector de semana, botón "Actualizar" (POST refresh) y texto "El sistema se suspende 21:30"; cinta L–D con avance (abre en hoy; `?sucursal=&dia=` en la URL); indicadores; bloque "Tareas de la sucursal"; tarjeta "Posibles LD hoy"; franja "Pendientes de días anteriores" (solo hoy); renglones de consolidado colapsables (`Collapsible`) con checklist (`task-step.tsx`: ícono, tachado si `done`, pastilla de avance, quién y hora) y `package-cards.tsx` a la derecha. Sin checkboxes interactivos. Estados de carga/vacío/error en llano.
- [ ] **Step 4:** Verificación en navegador (preview de app-pmy): abrir con Hermosillo hoy → ver tareas; cambiar a un día anterior → carga desde historial; cambiar sucursal; abrir un consolidado → tarjetas de paquetes; ancho móvil sin scroll horizontal. Sin errores en consola.
- [ ] **Step 5: Commit** (app-pmy) `feat(tareas): pantalla Tareas del día`

### Task 9: Cierre

- [ ] **Step 1:** `npx jest` (pmy-api) y `npx vitest run` (app-pmy) completos → PASS; `npx tsc --noEmit` en ambos sin errores nuevos.
- [ ] **Step 2:** `graphify update .` en pmy-api.
- [ ] **Step 3:** Anotar en memoria: migración `1786000000109` pendiente de prod; activar `operaciones.tareas` en roles.
- [ ] **Step 4: Commit** de cualquier ajuste final.
