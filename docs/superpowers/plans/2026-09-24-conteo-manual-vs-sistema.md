# Conteo manual vs sistema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (el usuario eligió ejecución inline). Steps con checkbox.

**Goal:** Pestaña "Conteo manual" (superadmin) en el Consolidador que compara el conteo POD/DEX07/DEX08 de un día contra FedEx en vivo + sistema + ingresos, explica cada diferencia y genera un prompt para corregir los errores del sistema.

**Architecture:** Backend NestJS: dos utils puros (`diagnose`, `prompt`) + un extractor puro del desenlace FedEx del día; un servicio que junta hechos por lotes y consulta FedEx con concurrencia 8 + caché 15 min. Front Next.js: parseo puro (pegado/Excel) + panel shadcn en una pestaña nueva.

**Tech Stack:** NestJS + TypeORM (MySQL, SQL crudo como `cobros-audit.service`), Jest; Next.js + shadcn + SWR/axios, `xlsx` para leer, `exceljs` para exportar, Vitest.

Spec: `docs/superpowers/specs/2026-09-24-conteo-manual-vs-sistema-design.md`

## Global Constraints

- Solo superadmin: roles `superadmin`, `superamin`, `owner` (FE oculta la pestaña; BE responde 403 al resto).
- Read-only: ningún endpoint nuevo escribe en BD.
- "Día" = día local Hermosillo (UTC-7), formato `YYYY-MM-DD` (usar `toHermosilloDateString`).
- DEX08 cobra solo con 3 días distintos con 08 en la misma semana ISO (`hasWeekWithThreeDex08Days`).
- UI solo shadcn (`@/components/ui/*`) + Tailwind + `DataTable`; textos en lenguaje simple.
- Validación con mensajes en español (class-validator).
- Tras cambios de código: `graphify update .` en pmy-api.

## Tipos compartidos (BE `src/consolidador/logic/manual-count.types.ts`, espejo FE `lib/types/manual-count.ts`)

```ts
export type Mark = 'POD' | '07' | '08';
export type DayOutcome = Mark | 'OTRO' | null;          // desenlace del día
export interface FedexLive { ok: boolean; outcome: DayOutcome; outcomeAt: string | null; dex08Dates: string[]; lastCode: string | null }
export interface RouteRef { dispatchId: string; folio: string | null; routeDay: string | null; is315: boolean; closed: boolean }
export interface IncomeRef { id: string; mark: Mark | null; day: string; cost: number; active: boolean }
export interface GuideFacts {
  trackingNumber: string;
  kind: 'shipment' | 'charge' | null;          // null = no existe
  subsidiaryId: string | null;
  transferredIn: boolean;                      // traspaso hacia la sucursal consultada
  consolidado: { consNumber: string | null; day: string | null } | null;
  routes: RouteRef[];
  systemStatus: string | null;                 // shipment.status vivo
  systemOutcome: DayOutcome;                   // de shipment_status en el día
  systemDex08Dates: string[];
  fedex: FedexLive | null;                     // null = no consultado / FedEx caído → ok=false
  incomes: IncomeRef[];                        // sourceType shipment, activos y anulados
  returned: boolean;                           // devolución registrada ese día o después
  warehouseDelivered: boolean;                 // entregado en bodega (warehouse_delivery) ese día
}
export interface DiagnoseContext { day: string; subsidiaryId: string; expectedCost: number; isChargeable(code: 'DELIVERED' | '07' | '08'): boolean }
export type Verdict = 'CUADRA' | 'ERROR_SISTEMA' | 'ERROR_CONTEO' | 'REGLA';
export type Cause = 'NO_EXISTE' | 'OTRA_SUCURSAL' | 'SIN_CONSOLIDADO' | 'SIN_RUTA' | 'RUTA_OTRO_DIA'
  | 'ESTATUS_DESFASADO' | 'COBRO_DE_MAS' | 'COBRO_FALTANTE' | 'INGRESO_OTRO_DIA' | 'DUPLICADO'
  | 'MONTO_INCORRECTO' | 'ERROR_CONTEO' | 'REGLA_NO_COBRA' | 'F2_INFORMATIVO' | null;
export interface ChainStep { step: number; label: string; ok: boolean | null; detail: string }
export interface DiagnosisRow {
  trackingNumber: string; manual: Mark | null; fedexSays: DayOutcome; systemSays: DayOutcome;
  charged: Mark[]; expected: Mark | null; verdict: Verdict; cause: Cause; subCause: string | null;
  explanation: string; chain: ChainStep[]; cost: number | null; incomeIds: string[];
}
export interface ManualCountReport {
  subsidiaryId: string; subsidiaryName: string | null; day: string; fedexFailures: number;
  totals: { manual: Record<Mark, number>; fedex: Record<Mark, number>; charged: Record<Mark, number>; byVerdict: Record<Verdict, number> };
  rows: DiagnosisRow[];
}
```

---

### Task 1: Desenlace FedEx del día (BE, puro)

**Files:** Create `src/consolidador/logic/fedex-day-outcome.util.ts` + `.spec.ts`; Modify `src/routeclosure/routeclosure.service.ts` (usar `selectLatestGeneration`).

**Produces:** `selectLatestGeneration(results: any[]): any | null` (orden por secuencia del UniqueID desc, igual a `getWinningTrackResult`) y `extractFedexDayOutcome(trackResult: any, day: string): FedexLive`.

Reglas: eventos `scanEvents` con día Hermosillo = `day`; `DL` → POD; `DE` con `exceptionCode` 07 → 07, 08 → 08; prioridad POD > 07 > 08; con otros eventos del día → `OTRO`; sin eventos del día → `null`. `dex08Dates` = TODOS los `DE`+`08` (cualquier día). `outcomeAt` = instante del evento elegido. Resultado vacío → `ok=false`.

- [ ] Tests: DL del día → POD; DE 08 del día + 2 de días previos → 08 con 3 fechas; DE 07 + DL mismo día → POD; eventos de otro día → null; 23:30 local del día anterior (06:30Z del día) → cuenta al día anterior; generación: 2 resultados, gana el de secuencia mayor.
- [ ] Fallar → implementar → pasar. Reemplazar el sort inline de `getWinningTrackResult` por `selectLatestGeneration`; `npx jest src/routeclosure src/consolidador` verde.
- [ ] Commit `feat(conteo-manual): desenlace FedEx del dia (util puro)`.

### Task 2: Diagnóstico por guía (BE, puro)

**Files:** Create `src/consolidador/logic/manual-count.types.ts`, `manual-count-diagnose.util.ts` + `.spec.ts`.

**Produces:** `diagnoseGuide(manual: Mark | null, facts: GuideFacts, ctx: DiagnoseContext): DiagnosisRow` y `summarize(rows): ManualCountReport['totals']`.

Algoritmo (la cadena se llena completa; `cause` = primer eslabón roto):
1. `kind===null` → NO_EXISTE. `subsidiaryId≠ctx.subsidiaryId && !transferredIn` → OTRA_SUCURSAL.
2. `kind==='charge'` → cobro agrupado: veredicto solo manual vs verdad; cause `F2_INFORMATIVO` si no cuadra el conteo.
3. Sin consolidado o `consolidado.day > day` → SIN_CONSOLIDADO.
4. Verdad = `fedex.ok ? fedex.outcome : systemOutcome`. Rutas del día = `routes` con `routeDay===day`. Sin ruta del día y `!warehouseDelivered` y verdad ∈ Mark: con rutas de otro día → RUTA_OTRO_DIA, si no → SIN_RUTA.
5. `fedex.ok && verdad ∈ Mark && systemOutcome !== verdad` → ESTATUS_DESFASADO.
6. Esperado: POD si `isChargeable('DELIVERED')` y `!returned`; 07 si `isChargeable('07')`; 08 si `hasWeekWithThreeDex08Days(fedex∪system dex08)` y `isChargeable('08')`; ruta del día `is315` → null (subCause "ruta 31.5"). Verdad 08 sin 3 días → null con subCause `DEX08 con N visita(s) en la semana`.
7. Cobrado = ingresos activos del día. Mismo código ×2 → DUPLICADO. Esperado null y cobrado → COBRO_DE_MAS (subCause del paso 6). Esperado X y cobrado Y≠X → COBRO_DE_MAS ("cobró Y, debía X"). Esperado X sin cobro del día: activo en otro día → INGRESO_OTRO_DIA; si no → COBRO_FALTANTE (subCause: ruta sin cierre / ingreso anulado / sin ruta). Costo ≠ `expectedCost` → MONTO_INCORRECTO.
8. Sistema OK: manual = esperado (o manual null y esperado null) → CUADRA; manual 08 y verdad 08 sin 3 días → REGLA (REGLA_NO_COBRA); resto → ERROR_CONTEO (incluye "no lo contaste").
Veredicto: causa en pasos 1–7 → ERROR_SISTEMA (F2_INFORMATIVO → ERROR_CONTEO).

- [ ] Tests (casos reales + sintéticos): 540148275693 (1 visita, cobrado 08) → ERROR_SISTEMA/COBRO_DE_MAS "1 visita"; 877368113055 (2 visitas) → COBRO_DE_MAS "2 visitas"; POD cobrado bien → CUADRA; usuario contó 08, FedEx POD, cobrado POD → ERROR_CONTEO; POD sin ruta → SIN_RUTA; ruta de otro día → RUTA_OTRO_DIA; ruta 31.5 cobrada → COBRO_DE_MAS; POD sin ingreso con ruta cerrada → COBRO_FALTANTE; ingreso en día siguiente → INGRESO_OTRO_DIA; 2 ingresos POD → DUPLICADO; costo 40 vs 52 → MONTO_INCORRECTO; otra sucursal; no existe; FedEx caído usa sistema; entregado en bodega sin ruta → CUADRA; DEX08 contado con 2 visitas sin cobro → REGLA; F2.
- [ ] Fallar → implementar → pasar → commit `feat(conteo-manual): diagnostico por guia (util puro)`.

### Task 3: Prompt determinista (BE, puro)

**Files:** Create `src/consolidador/logic/manual-count-prompt.util.ts` + `.spec.ts`.

**Produces:** `buildManualCountPrompt(input: { report: ManualCountReport; causes: Cause[] }): string` y constante `CAUSE_CODE_MAP: Record<string, { title: string; files: string[]; hint: string }>`.

Secciones: objetivo; contexto (sucursal, día, tabla contado/FedEx/cobrado); por causa elegida (solo ERROR_SISTEMA): qué pasa, hasta 10 guías con cadena resumida, archivos sospechosos, pista; reglas del proyecto (diagnosticar con SQL primero; esquema por migración, DB_SYNC=false; prueba que cubra el caso; NUNCA borrar ingresos: anular con `active=0`+`annulledAt`, con aprobación; `graphify update .`); criterios de aceptación.

- [ ] Tests: incluye causas elegidas y sus archivos; excluye ERROR_CONTEO/REGLA aunque se pidan; tope 10 guías + "y N más"; misma entrada → mismo texto.
- [ ] Fallar → implementar → pasar → commit `feat(conteo-manual): prompt determinista`.

### Task 4: Servicio + endpoints (BE)

**Files:** Create `src/consolidador/audit/manual-count.service.ts`, `src/consolidador/dto/manual-count.dto.ts`; Modify `consolidador.controller.ts`, `consolidador.module.ts` (providers `FedexService`, `ManualCountService`; import `ChargeRulesModule`).

**Consumes:** Tasks 1–3, `ChargeRulesService.buildResolver(subsidiaryId)`, `FedexService.trackPackage`, `toHermosilloDateString`, `rawUtcBounds`.

- `prefetchFedex(tns: string[])`: concurrencia 8, caché `Map<tn,{at,live}>` TTL 15 min; devuelve `{ done, failed }`.
- `diagnose(subsidiaryId, day, lists)`: universo = listas ∪ (ingresos activos del día, eventos de desenlace del día, guías en `package_dispatch_history` de rutas con `routeDate` del día) de la sucursal; hechos con queries `IN` (shipment, charge_shipment, consolidated, package_dispatch_history+package_dispatch+route_closure, shipment_status, income, devolution, warehouse_delivery, package_transfer); FedEx vía caché (lo faltante se consulta); descarta guías sin manual, sin ingreso y con verdad fuera de Mark; `summarize`.
- `prompt(subsidiaryId, day, body)` → `{ prompt }` reconstruyendo el reporte con `diagnose` (no confía en filas del cliente).
- Endpoints `POST :subsidiaryId/manual-count/fedex`, `POST :subsidiaryId/:day/manual-count`, `POST :subsidiaryId/:day/manual-count/prompt`; chequeo superadmin → `ForbiddenException('Solo superadmin puede usar el conteo manual.')`. DTO: arrays de strings (máx. 2000 por caja, 25 en fedex), mensajes en español.
- [ ] `npx tsc --noEmit` limpio; `npx jest src/consolidador` verde.
- [ ] Prueba real contra BD local: Hermosillo 22-09 con dex08=[540148275693, 877368113055] → ambas `COBRO_DE_MAS`.
- [ ] Commit `feat(conteo-manual): servicio y endpoints`.

### Task 5: Parseo de entrada (FE, puro)

**Files:** Create `app-pmy/lib/manual-count/parse.ts` + `parse.test.ts`.

**Produces:** `parseList(text: string): string[]` (separa por salto/coma/tab/espacio, quita no-dígitos al borde, únicos) ; `parseSheetRows(rows: unknown[][]): { pod: string[]; dex07: string[]; dex08: string[]; error?: string }` (detecta formato 3 columnas o `Guía|Estatus`) ; `findConflicts(l): string[]` (guías en 2+ cajas).

- [ ] Vitest: pegado con tabs/espacios/duplicados; 3 columnas con variantes de encabezado; 2 columnas con `ENTREGADO`/`DEX 08`/`7`; encabezados desconocidos → `error`; conflictos.
- [ ] Fallar → implementar → pasar → commit.

### Task 6: Panel y pestaña (FE)

**Files:** Create `lib/types/manual-count.ts`, `components/consolidador/manual-count-panel.tsx`, `manual-count-table.tsx`, `manual-count-prompt-dialog.tsx`, `lib/manual-count/export-excel.ts`; Modify `lib/services/consolidador.ts` (3 funciones), `app/finanzas/consolidador/page.tsx` (TabKey `conteo`, trigger solo si `isGlobal`).

- Panel: `Input type=date` (default hoy acotado a la semana), 3 `Textarea` con contador y aviso de conflictos, "Subir Excel" (xlsx → `parseSheetRows`), "Comparar": prefetch en bloques de 25 con `Progress` "Consultando FedEx… n/N", luego diagnóstico.
- Resumen: 3 tarjetas (POD/07/08: contado · FedEx · cobrado) + badges por veredicto.
- Tabla `DataTable`: Guía, Contó, FedEx dice, Sistema, Cobrado, Veredicto, Causa + explicación; filtro por veredicto/causa; fila expandible con cadena ✓/✗.
- Botones: "Generar prompt" (checkboxes de causas de sistema presentes) → diálogo con `Textarea` readonly + Copiar + Descargar `.md`; "Exportar Excel".
- [ ] `npx tsc --noEmit` y `npx vitest run lib/manual-count` limpios; lint del archivo tocado.
- [ ] Commit.

### Task 7: Verificación y cierre

- [ ] Levantar API (worktree) + front; en navegador: Consolidador → Hermosillo → pestaña Conteo manual → día 22-09 → pegar las 2 guías en DEX08 → ver COBRO_DE_MAS y generar prompt. Captura.
- [ ] `graphify update .` en pmy-api; actualizar memoria del proyecto.
