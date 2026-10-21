# Cierre de ruta con pre-cierre (piloto Cabo San Lucas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla completa de cierre de ruta (por flag de sucursal) con pre-cierre PDF obligatorio, comprobación guía por guía con cambios manuales auditados y señales de riesgo de LD.

**Architecture:** Back: migración 115 + utils puros (estatus manual, efectos de ingreso, señales LD) + endpoint de contexto + extensión de `routeclosure.create` en la misma transacción. Front: página nueva `operaciones/salidas-a-ruta/[id]/cierre` con wizard v2 (componentes nuevos), PDF con `@react-pdf/renderer`, y el candado de Salidas a ruta decide diálogo vs pantalla según el flag.

**Tech Stack:** NestJS + TypeORM (MySQL), jest · Next.js app router, shadcn + Tailwind, `@react-pdf/renderer`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-cierre-ruta-precierre-cabo-design.md`

## Global Constraints

- Flag: `subsidiary.routeClosureWithPreClosure` boolean default false; mig 115 lo enciende solo en Cabo San Lucas (id `abf2fc38-cb42-41b6-9554-4b71c11b8916`). Editable en cualquier momento desde Configuración; sin despliegue.
- Esquema SIEMPRE por migración (DB_SYNC=false). Migración defensiva con guard a `information_schema` (patrón de la 097).
- `shipment_status.source` varchar(32) NULL; valor manual: `'route_closure_manual'`.
- Nada se guarda en tiempo real: todo se aplica en `routeclosure.create`, en la misma transacción.
- Aviso entregado→DEX e ingresos manuales SOLO para paquetes (`isCharge=false`) en rutas `is315=false`.
- Motivo automático (texto fijo): `Cambio manual en cierre de ruta por {usuario}: guía {guía} de {antes} a {después}. Ruta {folio} del {fecha}, chofer {chofer}.`
- LD: reutilizar `classifyLd` (`src/common/ld-rule.util.ts`) con `requireNoMovement: false, excludeClosed: false`; día de negocio con `herDay`.
- UI: dentro de `AppLayout` + `withAuth("operaciones.salidasARutas")` + `OperationHeader`; solo `@/components/ui/*` + Tailwind; acciones fuertes en el header; UI densa (un renglón por guía); textos en llano, en español.
- El diálogo actual (`close-package-dispatch-form.tsx`) NO se modifica.
- Tras cambiar código: `graphify update .` en cada repo.

## Review Focus

1. Guía cambiada a mano que ya tiene ingreso NO_ENTREGADO esa semana → se sube a ENTREGADO, no se crea un segundo ingreso (Task 4 test `manual delivered upgrades existing no-entregado`).
2. La guía cambió de estatus (cron) entre abrir la pantalla y cerrar → el back rechaza con mensaje en llano, nada se aplica (Task 4 test `rejects stale previousStatus`).
3. Cambiar una guía y regresarla a su estatus original → no cuenta como cambio ni viaja en el payload (Task 7 test `reverting a change removes it`).
4. Guía sin `commitDateTime` → sin señal "Vence hoy" ni LD, sin error (Task 2 test `no commit date`).
5. Más de 20 devoluciones en el pre-cierre → la tabla continúa en otra hoja, no se corta (Task 6 test `paginates devoluciones by 20`).

---

### Task 1: Migración 115 y entidades

**Files:**
- Create: `src/database/migrations/1786000000115-RouteClosurePreClosure.ts`
- Create: `src/entities/route-closure-manual-status.entity.ts`
- Modify: `src/entities/subsidiary.entity.ts` (junto a `closureUntilNextDispatch` ~L273), `src/entities/shipment-status.entity.ts`, `src/entities/route-closure.entity.ts`, `src/routeclosure/routeclosure.module.ts` (TypeOrmModule.forFeature)

**Interfaces:**
- Produces: `Subsidiary.routeClosureWithPreClosure: boolean`; `ShipmentStatus.source?: string | null`; `RouteClosure.preClosureGeneratedAt?: Date | null`; entidad `RouteClosureManualStatus` (tabla `route_closure_manual_status`): `id uuid, routeClosureId, shipmentId nullable, chargeShipmentId nullable, trackingNumber, previousStatus varchar(64), newStatus varchar(64), exceptionCode varchar(16) null, reason text, createdById varchar(36) null, createdAt`.

- [ ] **Step 1:** Escribir la migración: columnas `subsidiary.routeClosureWithPreClosure tinyint NOT NULL DEFAULT 0`, `shipment_status.source varchar(32) NULL`, `route_closure.preClosureGeneratedAt datetime NULL`, `CREATE TABLE IF NOT EXISTS route_closure_manual_status` (índices en `routeClosureId` y `trackingNumber`), y `UPDATE subsidiary SET routeClosureWithPreClosure = 1 WHERE id = 'abf2fc38-cb42-41b6-9554-4b71c11b8916'`. `down()` revierte todo.
- [ ] **Step 2:** Agregar columnas/entidad en TypeORM y registrar la entidad en el módulo.
- [ ] **Step 3:** Run `npx tsc --noEmit -p tsconfig.json` → sin errores. Run `npm run migration:run` en local → aplica 115; verificar `SELECT name, routeClosureWithPreClosure FROM subsidiary WHERE routeClosureWithPreClosure=1` → solo Cabo San Lucas.
- [ ] **Step 4:** Commit `feat(cierre): migración 115 pre-cierre y auditoría de estatus manual`.

### Task 2: Señales de LD (util puro)

**Files:**
- Create: `src/routeclosure/pre-closure/ld-signals.util.ts`
- Test: `src/routeclosure/pre-closure/ld-signals.util.spec.ts`

**Interfaces:**
- Produces: `buildLdSignals(i: { status: string; commitDateTime: Date | string | null; routeDay: string; eventDays: Set<string>; dexDays: Set<string> }): { noMovement: boolean; dueToday: boolean; ldState: LdState }` — `noMovement = !eventDays.has(routeDay)`; `dueToday = herDay(commit) === routeDay`; `ldState = classifyLd({ status, due: dueToday ? 'today' : herDay(commit) < routeDay ? 'past' : null, dexOnCommitDay: dexDays.has(herDay(commit)), movedOnCommitDay: false, requireNoMovement: false, excludeClosed: false })`. Entregados → `noMovement=false`.

- [ ] **Step 1:** Tests: `en_ruta, vence hoy, sin eventos → {noMovement:true,dueToday:true,ldState:'possible_ld'}`; `DEX08 el día de vencimiento → ldState 'active'`; `vencido ayer sin DEX → 'ld'`; `entregado → {noMovement:false, ldState:'delivered'}`; `no commit date → {dueToday:false, ldState:'active'}`; `commit 2026-10-21T06:30Z con routeDay 2026-10-20 → dueToday true` (hora Hermosillo).
- [ ] **Step 2:** Run `npx jest src/routeclosure/pre-closure/ld-signals.util.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Run → PASS. Commit `feat(cierre): señales de riesgo de LD para el pre-cierre`.

### Task 3: Estatus manual y efectos de ingreso (utils puros) + helper de anulación compartido

**Files:**
- Create: `src/routeclosure/pre-closure/manual-status.util.ts`, test `manual-status.util.spec.ts`
- Create: `src/common/income-annul.util.ts` (mover el cuerpo de `DevolutionsService.annulEntregadoIncomeFor`, `src/devolutions/devolutions.service.ts:215`)
- Modify: `src/devolutions/devolutions.service.ts` (usar el helper; sin cambio de comportamiento)

**Interfaces:**
- Produces:
  - `type ManualOption = 'ENTREGADO' | 'DEX03' | 'DEX07' | 'DEX08' | 'DEX12' | 'OCURRE'`. `manualOptionToStatus(o): { status: ShipmentStatusType; exceptionCode: string | null }` — ENTREGADO→`entregado`/null, DEX03→`direccion_incorrecta`/'03', DEX07→`rechazado`/'07', DEX08→`cliente_no_disponible`/'08', DEX12→`no_entregado`/'12' (empresa_cerrada es STAT42), OCURRE→`es_ocurre`/null. (DHL usa sus códigos actuales, flujo DHL existente.)
  - `buildManualReason(i: { userName; trackingNumber; from; to; folio; routeDay; driverNames }): string` — texto fijo de Global Constraints.
  - `manualIncomeEffect(i: { isCharge: boolean; is315: boolean; from: string; to: string; hasDeliveredIncome: boolean }): 'create_delivered' | 'annul_delivered' | 'none'` — `isCharge || is315` → none; `to` entregado y `from` no entregado → create_delivered; `from` entregado y `to` no entregado y `hasDeliveredIncome` → annul_delivered.
  - `annulDeliveredIncome(manager: EntityManager, trackingNumber: string, shipmentId: string, opDate: Date, userId: string | null): Promise<string[]>`.

- [ ] **Step 1:** Tests: mapeo de las 6 opciones; motivo exacto con valores de ejemplo (`Cambio manual en cierre de ruta por Ana Ruiz: guía 878670898264 de Entregado a DEX08. Ruta 929567984667 del 2026-10-20, chofer Samuel Gaytán.`); efectos: carga→none, 31.5→none, DEX→entregado→create_delivered, entregado→DEX con ingreso→annul_delivered, entregado→DEX sin ingreso→none.
- [ ] **Step 2:** Run jest → FAIL. **Step 3:** Implementar y mover el helper. **Step 4:** Run jest del util + `src/devolutions` → PASS.
- [ ] **Step 5:** Commit `feat(cierre): reglas de estatus manual e ingreso; anulación de ingreso compartida`.

### Task 4: Aplicar cambios manuales en `routeclosure.create`

**Files:**
- Modify: `src/routeclosure/dto/create-routeclosure.dto.ts`, `src/routeclosure/routeclosure.service.ts:376-768`
- Create: `src/routeclosure/pre-closure/apply-manual-changes.ts`
- Test: `src/routeclosure/routeclosure.manual-status.spec.ts` (mismo estilo que `routeclosure.annulled-income.spec.ts`)

**Interfaces:**
- Consumes: Task 1 entidades; Task 3 utils.
- Produces: DTO `manualStatusChanges?: ManualStatusChangeInput[]` (`{ id: string; isCharge: boolean; trackingNumber: string; previousStatus: string; option: ManualOption }`, class-validator con mensajes en español) y `preClosureGeneratedAt?: string` (ISO). `applyManualChanges(manager, ctx: { dispatch; routeClosure; userId; userName; routeIncomeDate: Date }, changes): Promise<void>`.

Por cambio: validar que el id está en el historial de la salida y que el estatus vivo === `previousStatus` (si no: `BadRequestException('La guía {tn} cambió mientras cerrabas; recarga la pantalla.')`); actualizar estatus; insertar `ShipmentStatus` (`source='route_closure_manual'`, `notes=reason`, `timestamp` = hora del cierre); insertar `RouteClosureManualStatus`; efecto de ingreso: `create_delivered` → mismo antiduplicado del motor (`shipmentIncomeWhere` + semana: si hay NO_ENTREGADO vivo se sube a ENTREGADO; si hay ENTREGADO no se hace nada; si no hay, se crea con `fedexCostPackage`, `date = routeIncomeDate`, `createdById`); `annul_delivered` → `annulDeliveredIncome` y luego, si el DEX es cobrable con `noVanIncomeDecision` (resolved=true, dexCode del cambio, `dex08Dates` del historial), crear su NO_ENTREGADO. Se llama dentro de la transacción de `create`, antes del commit; guarda `preClosureGeneratedAt`.

- [ ] **Step 1:** Tests: `manual delivered creates one income`; `manual delivered upgrades existing no-entregado`; `entregado→DEX annuls and writes reversal`; `charge shipment changes status but no income`; `is315 route no income`; `rejects stale previousStatus` (y no aplica nada); `writes shipment_status with source and reason`; `writes route_closure_manual_status row`; `sin manualStatusChanges el create se comporta igual que hoy`.
- [ ] **Step 2:** Run `npx jest src/routeclosure/routeclosure.manual-status.spec.ts` → FAIL. **Step 3:** Implementar. **Step 4:** Run toda `src/routeclosure` → PASS.
- [ ] **Step 5:** Commit `feat(cierre): aplicar cambios manuales del cierre con auditoría e ingresos`.

### Task 5: Endpoint de contexto del pre-cierre

**Files:**
- Create: `src/routeclosure/pre-closure/pre-closure-context.service.ts`, test `pre-closure-context.service.spec.ts`
- Modify: `src/routeclosure/routeclosure.controller.ts`, `routeclosure.module.ts`

**Interfaces:**
- Consumes: Task 2 `buildLdSignals`.
- Produces: `GET /route-closure/:dispatchId/pre-closure-context` → `{ routeDay: string; is315: boolean; packages: { id: string; isCharge: boolean; trackingNumber: string; hasDeliveredIncome: boolean; noMovement: boolean; dueToday: boolean; ldState: LdState }[] }`. Guías desde `package_dispatch_history` (igual que `getShipmentsByPackageDispatchId`); `eventDays`/`dexDays` desde `shipment_status` en SQL agrupado (chunks de 800); `hasDeliveredIncome` = ingreso ENTREGADO vivo por `shipmentIncomeWhere` (cargas → false).

- [ ] **Step 1:** Tests con repos/datasource mockeados: devuelve señales por guía; carga → hasDeliveredIncome false; salida inexistente → NotFound.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npx jest src/routeclosure/pre-closure`).
- [ ] **Step 5:** Commit `feat(cierre): endpoint de contexto del pre-cierre`.

### Task 6: Front — flag, entrada y PDF del pre-cierre (app-pmy)

**Files:**
- Modify: `lib/types.ts` (Subsidiary L40-62: `routeClosureWithPreClosure?: boolean`; RouteClosure L951: `manualStatusChanges?`, `preClosureGeneratedAt?`), `components/configuracion/subsidiary-config-panel.tsx` (FLAGS L40-50: label "Cierre en pantalla completa con pre-cierre"), `components/package-dispatch/package-dispatch-control.tsx` (L151-165 y query `cerrar` L60-65: si `row.subsidiary.routeClosureWithPreClosure` → `router.push(/operaciones/salidas-a-ruta/${id}/cierre)`), `lib/services/route-closure.ts` (`getPreClosureContext(dispatchId)`)
- Create: `lib/services/route-closure/pre-closure-sheet.ts` (datos puros), `lib/services/route-closure/pre-closure-pdf.tsx`
- Test: `lib/services/route-closure/pre-closure-sheet.test.ts`

**Interfaces:**
- Produces: `buildPreClosureSheet(input: { companyName: string; city: string; driver: string; routeDay: string; vehicle?: string; kmOut?: number; packages: ClosurePackageVM[]; codPackages: { tc: string; amount: number; trackingNumber: string }[] }): PreClosureSheet` con `devolucionPages: { trackingNumber; dex: string; ld: boolean }[][]` (20 por hoja), `ldRisk: { trackingNumber; recipient; due; signals: string[] }[]`, `totals: { received; returned; dex03; dex07; dex08; dex12; collections: number; effective }`. `PreClosurePDF({ sheet })` dibuja la hoja manual (encabezado, Devolución, Recolección en blanco, Cash, resumen, "Guías con riesgo de LD", observaciones, firma de recibido), LETTER, mismo estilo que `route-closure-pdf-generator.tsx`.
- `ClosurePackageVM` (definido aquí, usado en Task 7): `{ id; isCharge; trackingNumber; carrier: 'FedEx' | 'DHL'; recipient: string; systemStatus: string; systemCode: string | null; commitDateTime?: string; hasDeliveredIncome: boolean; noMovement: boolean; dueToday: boolean; ldState: string }`.

- [ ] **Step 1:** Tests: totales con el ejemplo de la hoja (42 recibidos, 7 devueltos, 3 DEX03, 4 DEX08 → 35 efectivas); `paginates devoluciones by 20` (25 → 2 hojas: 20 + 5); ldRisk incluye solo no entregadas con alguna señal.
- [ ] **Step 2–4:** `npx vitest run lib/services/route-closure/pre-closure-sheet.test.ts` FAIL → implementar → PASS.
- [ ] **Step 5:** Commit (app-pmy) `feat(cierre): flag de sucursal, entrada a pantalla nueva y PDF de pre-cierre`.

### Task 7: Front — pantalla del cierre v2

**Files:**
- Create: `app/operaciones/salidas-a-ruta/[id]/cierre/page.tsx`
- Create: `components/route-closure-v2/route-closure-screen.tsx` (header + stepper + carga), `step-pre-closure.tsx`, `step-verification.tsx`, `step-finish.tsx`, `verification-columns.tsx`, `closure-changes.ts` (lógica pura)
- Test: `components/route-closure-v2/closure-changes.test.ts`

**Interfaces:**
- Consumes: Task 5 endpoint vía `getPreClosureContext`; Task 6 `ClosurePackageVM`, `PreClosurePDF`, `buildPreClosureSheet`; existentes `reconcile`, `getShipmensByDispatchId`, `save`, `uploadFiles`, `classifyClosureBucket`, `ScanInput`/`clearScanBuffer`, `DataTable` (`searchKey="trackingNumber"`, `filters` para `carrier`, `bucket`, `ldSignal`, `changed`; `rowClassName` → `bg-amber-50` si cambió).
- Produces (en `closure-changes.ts`): `applyChange(changes: Record<string, ManualOption>, pkg: ClosurePackageVM, option: ManualOption | null): Record<string, ManualOption>` (si `option` equivale al estatus del sistema, borra la llave); `effectiveBucket(pkg, changes): 'POD' | 'DEX' | 'Otros'`; `needsIncomeWarning(pkg, option, is315): boolean` (`!isCharge && !is315 && hasDeliveredIncome && systemStatus entregado && option !== 'ENTREGADO'`); `toPayload(changes, pkgs): ManualStatusChangeInput[]`.

Comportamiento: Paso 1 = tarjetas de hoy + tarjeta "Riesgo de LD"; "Generar pre-cierre" descarga el PDF y guarda `preClosureGeneratedAt` en estado; "Siguiente" muestra el aviso si no se generó. Paso 2 = pestañas Todos/POD/DEX/Otros/Recolecciones/No VAN, tabla con selector FedEx (6 opciones) o DHL (catálogo `dhl_status`, confirmación obligatoria como hoy), pastillas de señales LD, `AlertDialog` "Esta guía ya tiene un ingreso generado. Si continúas, ese ingreso se anula." cuando `needsIncomeWarning`. Paso 3 = km llegada, lista de cambios (antes → después), "Cerrar ruta" → `save({...payloadDeHoy, manualStatusChanges, preClosureGeneratedAt})`, `clearScanBuffer` de ambas llaves, PDF/Excel de cierre y `uploadFiles` como el diálogo, y regreso a Salidas a ruta. Errores del back con `apiError` (llano).

- [ ] **Step 1:** Tests: `reverting a change removes it`; `DEX→ENTREGADO moves bucket to POD`; `needsIncomeWarning false for charge`, `false for is315`, `true for delivered package with income`; `toPayload sends previousStatus from system`.
- [ ] **Step 2–4:** `npx vitest run components/route-closure-v2` FAIL → implementar → PASS; `npx tsc --noEmit` y `npm run lint` sin errores en archivos tocados.
- [ ] **Step 5:** Commit (app-pmy) `feat(cierre): pantalla completa de cierre con pre-cierre y comprobación`.

### Task 8: Verificación de punta a punta

- [ ] **Step 1:** Levantar back y front en local (preview); con una salida de Cabo San Lucas: candado abre la pantalla; "Siguiente" bloqueado sin pre-cierre; PDF se parece a la hoja; filtros (guía, FedEx/DHL, estatus, riesgo LD, solo cambiados); cambiar entregado→DEX08 muestra aviso; cerrar.
- [ ] **Step 2:** En BD local: `shipment_status` con `source='route_closure_manual'`, fila en `route_closure_manual_status`, ingreso anulado + reversa, `route_closure.preClosureGeneratedAt` lleno.
- [ ] **Step 3:** Con otra sucursal: el candado abre el diálogo de siempre. Apagar el flag de Cabo en Configuración → vuelve al diálogo.
- [ ] **Step 4:** `graphify update .` en ambos repos; commit final si hay ajustes. Mig 115 pendiente de correr en prod.
