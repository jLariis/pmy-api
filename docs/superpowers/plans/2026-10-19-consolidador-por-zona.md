# Consolidador por zona — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Preferencia del usuario:** trabajo inline (executing-plans), sin subagentes.

**Goal:** Todo el Consolidador se puede ver por zona, con Resumen por sucursal, y el conteo manual y la auditoría revisan también cargas, recolecciones y No VAN.

**Architecture:** BE: cada vista sigue existiendo por sucursal. La zona es un único endpoint genérico `GET consolidador/zone/:zoneId/:from/:to/:view` que resuelve las sucursales de la zona y corre el servicio por sucursal (máximo 2 a la vez). Devuelve `ZonePart<T>[]`, es decir `{ subsidiaryId, subsidiaryName, data }`. FE: un hook `useScopedView` devuelve siempre `ZonePart<T>[]` (en modo sucursal envuelve la respuesta única), y cada vista agrupa por sucursal desde ahí.

**Tech Stack:** NestJS + TypeORM (MySQL, SQL directo vía `dataSource.query`), Jest · Next.js + shadcn + Tailwind + SWR, Vitest (environment node, solo lógica pura en `lib/`).

**Spec:** `docs/superpowers/specs/2026-10-19-consolidador-por-zona-design.md`

## Global Constraints

- Ramas: `feat/consolidador-zona` en `C:\PMY\pmy-api` y en `C:\PMY\app-pmy`, desde `main`. En pmy-api, `main` está tomado por el worktree `C:\PMY\pmy-api-semana`; se usa `git switch -c feat/consolidador-zona main` (antes verificar con `git log main..feat/actualizar-servidor` qué no está en main y avisar al usuario). Al final: merge a main + push main, solo con el OK del usuario.
- Esquema SOLO por migración (DB_SYNC=false). Migraciones nuevas: la siguiente libre después de `1786000000111` (verificar también en `C:\PMY\pmy-api-semana`).
- Tipos espejo BE↔FE: `src/consolidador/logic/manual-count.types.ts` ↔ `app-pmy lib/types/manual-count.ts`, y `src/consolidador/zone/zone.types.ts` ↔ `app-pmy lib/types/consolidador-zone.ts`. Se mantienen en sincronía en el mismo task.
- UI: dentro de AppLayout + withAuth + OperationHeader; solo `@/components/ui/*` + Tailwind; tablas con `DataTable`; acciones fuertes en el header; textos en llano (nunca "charge_shipment", "shipment_not_in_files", "intake"): se dice "carga", "No VAN", "recolección"; loader `PmyLoader`/`PmySpinner`.
- Solo `income.active = 1` cuenta como cobro. Ninguna acción automática: toda corrección es un botón por guía con motivo, y reusa `DELETE consolidador/income/:id` o `POST consolidador/income`.
- Nunca clonar, mover ni borrar `shipment`/`charge_shipment`.
- Concurrencia por zona: 2 sucursales a la vez como máximo.
- Permiso nuevo: `finanzas.consolidador.conteoManual` · nombre `Consolidador · Conteo manual` · grupo `Finanzas` · roles `['superadmin']`.
- Cada commit visible lleva `release-notes/pending/*.json` con su nota en llano (regla de la casa; seguir el formato de los existentes).
- Tras tocar código: `graphify update .`; resolver todos los errores de tsc en los archivos tocados.

## Review Focus

1. **Zona sin sucursales asignadas** (o un usuario no global sin ninguna sucursal de la zona) → mensaje en llano "Esta zona no tiene sucursales asignadas" / "No tienes sucursales en esta zona"; nunca 500 ni pantalla vacía sin explicación. Test en Task 2 (`pickScopeSubsidiaries` devuelve `[]`) y en Task 10 Step 5 (el mensaje del 403 se muestra tal cual en la UI).
2. **Guía pegada que existe en dos sucursales de la zona** (traspaso, reingreso) → se asigna a una sola, la del registro vigente ese día; nunca sale duplicada en dos grupos. Test en Task 7.
3. **Ingreso de paquete con `shipmentId` vacío** (ingresos del 19-oct) → el doble se detecta igual por guía. Test en Task 3.
4. **No VAN que además existe como paquete** (lo registraron después) → manda el paquete y no se cuenta dos veces. Test en Task 5 y Task 6.
5. **Una sucursal de la zona falla** (timeout o error) → las demás se muestran y esa aparece con "No se pudo cargar". Test en Task 2 (`runWithLimit` con un rechazo) en `flattenParts` (Task 9) y en la fila "No se pudo cargar" del Resumen (Task 11).
6. **Nota:** "Qué revisar primero" se arma con los números del resumen ("32 guías faltan por cobrar ($3,904)"). No dice "31 guías del correo sin subir" porque eso sale solo del conteo manual; es una simplificación respecto a la maqueta.

---

## Estructura de archivos

**pmy-api** (`src/consolidador/`)
- `zone/zone.types.ts`: `ZonePart<T>`, `ZoneView`, `ScopeSubsidiary`, tipos de las tablas nuevas y del resumen.
- `logic/zone-scope.util.ts` (+spec): `pickScopeSubsidiaries`, `runWithLimit`.
- `logic/charge-doubles.util.ts` (+spec): `detectChargeDoubles`.
- `logic/collection-audit.util.ts` (+spec): `classifyCollectionAudit`.
- `logic/novan-audit.util.ts` (+spec): `classifyNoVan`.
- `logic/zone-locate.util.ts` (+spec): `locateGuides`.
- `logic/summary-issue.util.ts` (+spec): `buildTopIssue`.
- `audit/charge-guides.service.ts`, `audit/collections-audit.service.ts`, `audit/novan-audit.service.ts`, `read/summary.service.ts`, `zone/zone.service.ts`.
- Modificar: `consolidador.controller.ts`, `consolidador.module.ts`, `audit/manual-count.service.ts`, `logic/manual-count-diagnose.util.ts`, `logic/manual-count.types.ts`, `dto/manual-count.dto.ts`, `src/auth/rbac/permission-catalog.ts`.
- Entidad nueva `src/entities/manual-count-run.entity.ts` + 2 migraciones (permiso, tabla).

**app-pmy**
- `lib/types/consolidador-zone.ts`, `lib/consolidador/scope.ts` (+test), `lib/consolidador/zone-merge.ts` (+test).
- `lib/services/consolidador.ts` (funciones nuevas), `hooks/services/consolidador/use-scoped-view.ts`.
- `components/consolidador/`: `scope-switcher.tsx`, `subsidiary-pills.tsx`, `summary-view.tsx`, `charge-guides-table.tsx`, `collections-audit-table.tsx`, `novan-table.tsx`, `search-sheet.tsx`, `subsidiary-group.tsx`.
- Modificar: `app/finanzas/consolidador/page.tsx`, `cobros-audit-panel.tsx`, `groups-view.tsx`, `manual-count-panel.tsx`, `manual-count-table.tsx`, `lib/types/manual-count.ts`.

---

### Task 1: Permiso propio del conteo manual

**Files:**
- Modify: `src/auth/rbac/permission-catalog.ts:79` (agregar debajo de `finanzas.consolidador`)
- Create: `src/database/migrations/<N>-SyncConsolidadorConteoPermission.ts`
- Modify: `src/consolidador/consolidador.controller.ts:42-66`

**Interfaces:**
- Produces: código de permiso `finanzas.consolidador.conteoManual` (lo usa el FE en Task 13).

- [ ] **Step 1:** Agregar al catálogo `{ code: 'finanzas.consolidador.conteoManual', name: 'Consolidador · Conteo manual', groupName: 'Finanzas', roles: ['superadmin'] }`.
- [ ] **Step 2:** Crear la migración copiando la lógica idempotente de `1786000000066-SyncConsolidadorPermission.ts`. El `down` borra solo `['finanzas.consolidador.conteoManual']`.
- [ ] **Step 3:** En el controller, cambiar `assertSuperadmin(req)` de los 3 endpoints `manual-count*` por `@RequirePermission('finanzas.consolidador.conteoManual')` + `@UseGuards(PermissionsGuard)` a nivel método (el guard de clase `ConsolidadorAccessGuard` se queda). Borrar `assertSuperadmin` si ya nadie la usa.
- [ ] **Step 4:** Correr la migración en local: `npm run migration:run` (o el script de migraciones del repo). Esperado: aparece la fila en `permission` y en `role_permissions` del superadmin; correrla dos veces no duplica.
- [ ] **Step 5:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep consolidador.controller` → sin errores.
- [ ] **Step 6:** Commit `feat(consolidador): permiso propio para el conteo manual` + nota en `release-notes/pending/`.

### Task 2: Alcance por zona (util + servicio + endpoint genérico)

**Files:**
- Create: `src/consolidador/zone/zone.types.ts`, `src/consolidador/logic/zone-scope.util.ts`, `src/consolidador/logic/zone-scope.util.spec.ts`, `src/consolidador/zone/zone.service.ts`
- Modify: `consolidador.controller.ts` (endpoint nuevo antes de `getWeek`), `consolidador.module.ts`

**Interfaces:**
- Produces:
  - `interface ScopeSubsidiary { id: string; name: string }`
  - `interface ZonePart<T> { subsidiaryId: string; subsidiaryName: string; data: T | null; error: string | null }`
  - `type ZoneView = 'week' | 'by-route' | 'by-consolidado' | 'cobros-audit' | 'summary' | 'charge-guides' | 'collections' | 'novan'`
  - `pickScopeSubsidiaries(rows: { id: string; name: string; zoneId: string | null; active: boolean }[], zoneId: string, user: { role: string; subsidiaryIds?: string[] }): ScopeSubsidiary[]`
  - `runWithLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]>` (respeta el orden de entrada)
  - `ZoneService.subsidiariesOf(zoneId: string, user): Promise<ScopeSubsidiary[]>` (lanza `ForbiddenException` en llano si queda vacío)
  - `ZoneService.run<T>(zoneId, user, fn: (s: ScopeSubsidiary) => Promise<T>): Promise<ZonePart<T>[]>`
  - Endpoint `GET consolidador/zone/:zoneId/:fromDate/:toDate/:view` → `ZonePart<any>[]`

- [ ] **Step 1: Tests**
```ts
describe('pickScopeSubsidiaries', () => {
  const rows = [
    { id: 'a', name: 'La Paz', zoneId: 'z1', active: true },
    { id: 'b', name: 'Cabo San Lucas', zoneId: 'z1', active: true },
    { id: 'c', name: 'Loreto', zoneId: 'z1', active: false },
    { id: 'd', name: 'Hermosillo', zoneId: 'z2', active: true },
  ];
  it('global ve todas las activas de la zona, por nombre', () =>
    expect(pickScopeSubsidiaries(rows, 'z1', { role: 'superadmin' }).map((s) => s.id)).toEqual(['b', 'a']));
  it('no global solo ve las asignadas', () =>
    expect(pickScopeSubsidiaries(rows, 'z1', { role: 'admin', subsidiaryIds: ['a', 'd'] }).map((s) => s.id)).toEqual(['a']));
  it('zona sin sucursales → []', () => expect(pickScopeSubsidiaries(rows, 'z9', { role: 'superadmin' })).toEqual([]));
});
describe('runWithLimit', () => {
  it('nunca corre más de 2 a la vez y conserva el orden', async () => { /* contador de activos ≤ 2; resultados en orden */ });
  it('un rechazo no tumba a los demás', async () => {
    const r = await runWithLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('x'); return n; });
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
```
- [ ] **Step 2:** `npx jest src/consolidador/logic/zone-scope.util.spec.ts` → FAIL (no existe).
- [ ] **Step 3:** Implementar el util. Los roles globales son `ConsolidadorAccessGuard.GLOBAL_ROLES`. Nombres ordenados con `localeCompare('es')`.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** `ZoneService`: `SELECT id, name, zoneId, active FROM subsidiary WHERE zoneId = ?`, luego `pickScopeSubsidiaries`. Si queda vacío y la zona tiene sucursales → "No tienes sucursales asignadas en esta zona."; si la zona no tiene ninguna → "Esta zona no tiene sucursales asignadas. Asígnalas en Administración → Zonas." En `run`, `runWithLimit(subs, 2, fn)` y cada rechazo se vuelve `{ data: null, error: 'No se pudo cargar esta sucursal.' }` (el detalle se loguea).
- [ ] **Step 6:** Endpoint `zone/:zoneId/:fromDate/:toDate/:view`: switch por `view` que llama al servicio por sucursal existente con las mismas conversiones de fecha que sus pares (`T00:00:00.000` / `T23:59:59.999`): `week`→`read.getWeek(id, from, to, {})`, `by-route`/`by-consolidado`→`groups`, `cobros-audit`→`cobrosAudit.audit`. Las vistas nuevas se conectan en los Tasks 3, 4, 5 y 8. Si `view` es desconocida → `BadRequestException('Vista no válida.')`. Declararlo antes del catch-all de 3 segmentos.
- [ ] **Step 7:** Probar con el API local: `curl -H "Authorization: Bearer <token>" localhost:3000/consolidador/zone/<zoneId>/2026-10-12/2026-10-18/week` → arreglo con una parte por sucursal.
- [ ] **Step 8:** Commit `feat(consolidador): vista por zona (endpoint genérico)`.

### Task 3: Cargas y guías dobles (paquete + carga)

**Files:**
- Create: `src/consolidador/logic/charge-doubles.util.ts` (+spec), `src/consolidador/audit/charge-guides.service.ts`
- Modify: `zone/zone.types.ts`, controller (`GET :subsidiaryId/:fromDate/:toDate/charge-guides` antes del catch-all + `view='charge-guides'` en el de zona), module

**Interfaces:**
- Produces:
```ts
interface ChargeGuideInput { chargeShipmentId: string; trackingNumber: string; chargeId: string; consNumber: string | null; chargeDay: string; uploadedAt: string | null; uploadedBy: string | null }
interface ShipmentTwin { shipmentId: string; trackingNumber: string; consNumber: string | null; consDay: string | null; createdAt: string }
interface PackageIncome { incomeId: string; trackingNumber: string; shipmentId: string | null; cost: number; day: string }
interface ChargeGuideRow extends ChargeGuideInput { twin: ShipmentTwin | null; packageIncome: PackageIncome | null; isDouble: boolean; overcharged: boolean }
interface ChargeGuidesReport {
  charges: { chargeId: string; consNumber: string | null; chargeDay: string; uploadedAt: string | null; uploadedBy: string | null; guides: number; doubles: number }[];
  rows: ChargeGuideRow[];
  totals: { guides: number; doubles: number; overcharged: number; overchargedAmount: number };
}
function detectChargeDoubles(guides: ChargeGuideInput[], twins: ShipmentTwin[], incomes: PackageIncome[], week: { from: string; to: string }): ChargeGuideRow[]
```

- [ ] **Step 1: Tests** (`week = { from: '2026-10-12', to: '2026-10-18' }`)
  - `twin con consDay '2026-10-16' → isDouble true`
  - `twin con consDay '2026-10-05' (semana anterior) → isDouble true`; `'2026-09-28' → false`
  - `twin + income por shipmentId → overcharged true, packageIncome.incomeId = 'i1'`
  - `income con shipmentId null y misma guía → igual se liga (overcharged true)`
  - `income cuyo shipmentId es de OTRA fila → no se liga`
  - `sin twin → isDouble false, overcharged false`
- [ ] **Step 2:** `npx jest src/consolidador/logic/charge-doubles.util.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar. Si hay varios twins, gana el de `consDay` más reciente dentro de la ventana `[from − 7 días, to]`. Income: primero por `shipmentId === twin.shipmentId`; si no hay, uno con `shipmentId === null` y la misma guía.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Servicio `ChargeGuidesService.report(subsidiaryId, from: string, to: string): Promise<ChargeGuidesReport>`. Hace 3 queries:
  1. `charge_shipment cs JOIN charge ch` con `cs.active=1`, `ch.subsidiaryId=?` y `DATE(ch.chargeDate)` en la semana. `uploadedAt`/`uploadedBy` salen de `import_file` por `consNumber` (el usuario que subió, nombre + apellido).
  2. `shipment` con `active=1`, la misma sucursal y `trackingNumber IN (...)`, con `consolidated`.
  3. `income` con `active=1`, `sourceType='shipment'`, la sucursal y `trackingNumber IN (...)`.
  
  `overchargedAmount` = suma de `packageIncome.cost`.
- [ ] **Step 6:** Verificar contra la BD local con Cabo 12–18 oct: `totals.doubles` ≥ 23 y aparecen 878182412923 y 878466550962 (si el respaldo local no trae esa semana, anotarlo y probar con la semana más reciente).
- [ ] **Step 7:** Commit `feat(consolidador): guías que están como paquete y como carga`.

### Task 4: Auditoría de recolecciones

**Files:**
- Create: `src/consolidador/logic/collection-audit.util.ts` (+spec), `src/consolidador/audit/collections-audit.service.ts`
- Modify: `zone.types.ts`, controller (`GET :subsidiaryId/:fromDate/:toDate/collections`, `POST consolidador/fedex/prefetch`, `view='collections'`), module, `audit/manual-count.service.ts` (hacer pública `cachedFedex(tn)` envolviendo `cached`)

**Interfaces:**
- Consumes: `collectionDayOf`, `pickedUpDayOf` de `logic/manual-count-collection.util.ts`; `ManualCountService.prefetchFedex(tns)` y `cachedFedex(tn)`.
- Produces:
```ts
type CollectionAuditStatus = 'cobrada' | 'sin_cobro' | 'no_cobra_315' | 'duplicada';
function classifyCollectionAudit(c: { is315: boolean; activeIncomes: number }): CollectionAuditStatus
interface CollectionAuditRow { trackingNumber: string; day: string; registeredAt: string; routeLabel: string | null; is315: boolean; fedexPickedUpDay: string | null; fedexChecked: boolean; status: CollectionAuditStatus; incomeIds: string[]; amount: number }
interface CollectionsAuditReport { rows: CollectionAuditRow[]; totals: { registered: number; charged: number; withoutCharge: number } }
```
- Endpoint `POST consolidador/fedex/prefetch` body `{ trackingNumbers: string[] }` (≤25, reusa `ManualCountFedexDto`) → `{ done, failed }`, con el permiso `finanzas.consolidador` de siempre.

- [ ] **Step 1: Tests:** `is315 → 'no_cobra_315'` (aunque tenga cobro), `0 → 'sin_cobro'`, `1 → 'cobrada'`, `2 → 'duplicada'`.
- [ ] **Step 2:** `npx jest src/consolidador/logic/collection-audit.util.spec.ts` → FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** `CollectionsAuditService.report(subsidiaryId, from, to)` reusa las mismas consultas de recolecciones de `ManualCountService.diagnoseCollections` (tabla `collection`, día por `collectionDayOf`, 31.5 vía `route_closure.collections` + `package_dispatch.is315`, `income` con `sourceType='collection'`). Si se puede, extraer esas consultas a un helper compartido en lugar de duplicarlas. `fedexPickedUpDay` sale solo de `cachedFedex`; `fedexChecked` = hay caché.
- [ ] **Step 6:** Commit `feat(consolidador): auditoría de recolecciones`.

### Task 5: Auditoría de No VAN

**Files:**
- Create: `src/consolidador/logic/novan-audit.util.ts` (+spec), `src/consolidador/audit/novan-audit.service.ts`
- Modify: `zone.types.ts`, controller (`GET :subsidiaryId/:fromDate/:toDate/novan`, `view='novan'`), module

**Interfaces:**
- Consumes: `noVanIncomeDecision`, `NoVanFedexOutcome` de `src/routeclosure/novan-income.util.ts`.
- Produces:
```ts
type NoVanStatus = 'cobrada' | 'sin_cobro' | 'no_cobra_315' | 'en_transito' | 'sin_verificar' | 'es_paquete';
function classifyNoVan(i: { is315: boolean; activeIncomes: number; existsAsShipment: boolean; fedex: NoVanFedexOutcome | null }): { status: NoVanStatus; suggestedKind: 'pod' | 'dex' | null }
interface NoVanRow { trackingNumber: string; routeDay: string | null; routeFolio: string | null; driver: string | null; closedAt: string | null; is315: boolean; fedexLabel: string | null; status: NoVanStatus; suggestedKind: 'pod' | 'dex' | null; incomeIds: string[] }
interface NoVanReport { rows: NoVanRow[]; totals: { total: number; charged: number; withoutCharge: number } }
```

- [ ] **Step 1: Tests:**
  - `existsAsShipment → 'es_paquete'` (manda el paquete)
  - `is315 → 'no_cobra_315'`
  - `activeIncomes ≥ 1 → 'cobrada'`
  - `fedex null → 'sin_verificar'`
  - FedEx entregado sin cobro → `'sin_cobro'` con `suggestedKind 'pod'`
  - FedEx DEX que cobra (según `noVanIncomeDecision`) → `'sin_cobro'` con `'dex'`
  - FedEx en tránsito (decision null) → `'en_transito'`
- [ ] **Step 2–4:** FAIL → implementar → PASS (`npx jest src/consolidador/logic/novan-audit.util.spec.ts`).
- [ ] **Step 5:** `NoVanAuditService.report(subsidiaryId, from, to)`. Lee `shipment_not_in_files n LEFT JOIN package_dispatch pd ON pd.id = n.dispatchId LEFT JOIN route_closure rc ON rc.id = n.routeClosureId`, de la sucursal, con día = `pd.routeDate` (o, si falta, el día Hermosillo de `rc.closeDate`) dentro de la semana. Trae el chofer de la ruta, el `income` activo por guía (`sourceType='shipment'`) y `existsAsShipment` (`shipment.active=1` con la misma guía y sucursal). El outcome FedEx sale de `cachedFedex` con el mismo mapeo que `RouteclosureService.resolveNoVanOutcome` (reusar o extraer un helper puro; no duplicar la lógica).
- [ ] **Step 6:** Commit `feat(consolidador): auditoría de No VAN`.

### Task 6: Conteo manual — No VAN, dobles y "comparar también contra"

**Files:**
- Modify: `src/consolidador/logic/manual-count.types.ts`, `logic/manual-count-diagnose.util.ts` (+spec), `audit/manual-count.service.ts` (`loadFacts`, `diagnose`), `dto/manual-count.dto.ts`; espejo en `app-pmy lib/types/manual-count.ts`

**Interfaces:**
- Produces (cambios de tipos):
  - `GuideFacts.kind: 'shipment' | 'charge' | 'novan' | null`
  - `GuideFacts.novan?: { dispatchId: string | null; routeDay: string | null; folio: string | null; driver: string | null; is315: boolean } | null`
  - `GuideFacts.twinCharge?: { consNumber: string | null; chargeDay: string | null } | null` (en un envío que también existe como carga)
  - `Cause` += `'NOVAN_SIN_COBRO' | 'NOVAN_31_5' | 'DOBLE_PAQUETE_CARGA'`
  - `DiagnosisRow.source: 'shipment' | 'charge' | 'novan' | null` y `DiagnosisRow.where: string` (frase "Dónde está en el sistema", p. ej. `Paquete 305823283233 + Carga 305823555448`, `No VAN · Ruta 15/10 · Gustavo`, `No existe`)
  - `ManualLists.sources?: { charges: boolean; collections: boolean; novan: boolean }` (si falta, todo `true`)

- [ ] **Step 1: Tests nuevos** en `manual-count-diagnose.util.spec.ts`:
  - `No VAN cobrado el día → verdict CUADRA, source 'novan'`
  - `No VAN sin cobro, FedEx POD ese día → ERROR_SISTEMA, cause NOVAN_SIN_COBRO`
  - `No VAN en ruta 31.5 → REGLA, cause NOVAN_31_5`
  - `envío con twinCharge e ingreso activo del día, sin conteo manual → ERROR_SISTEMA, cause DOBLE_PAQUETE_CARGA, incomeIds = [id del ingreso del paquete]`
  - `envío con twinCharge y sin ingreso → no es DOBLE (sigue la cadena normal)`
  - `kind null sigue siendo NO_EXISTE`
- [ ] **Step 2:** `npx jest src/consolidador/logic/manual-count-diagnose.util.spec.ts` → FAIL.
- [ ] **Step 3:** En `diagnoseGuide`, rama `kind === 'novan'` antes de la cadena de envíos: si es 31.5 → `NOVAN_31_5`; si hay ingreso activo → cuadra o `MONTO_INCORRECTO` como hoy; si no hay ingreso y FedEx dice que cobra → `NOVAN_SIN_COBRO`. La explicación va en llano: "La anotaron como No VAN en el cierre de la ruta del {dd/mm} ({chofer}); no es paquete del sistema." En envíos con `twinCharge` y un ingreso activo, `DOBLE_PAQUETE_CARGA` gana a las demás causas: "Se cobró como paquete y además va en la carga {consNumber}." Llenar `source` y `where` en todas las ramas.
- [ ] **Step 4:** PASS, y la suite completa del conteo sigue verde: `npx jest src/consolidador/logic/manual-count`.
- [ ] **Step 5:** En `loadFacts`: con `sources.novan`, para las guías sin fila de envío ni carga, buscar en `shipment_not_in_files` de la sucursal (con `package_dispatch` del historial y el chofer) y marcar `kind='novan'`. Con `sources.charges`, para los envíos, detectar `twinCharge` (fila `charge_shipment` activa de la misma guía y sucursal). Con `sources.charges=false`, ignorar las filas `kind 'charge'`. Con `sources.collections=false`, no correr `diagnoseCollections`. Agregar al universo del sistema (`systemUniverse`) los No VAN de los días revisados, para que "cobrado y no lo contó" los incluya.
- [ ] **Step 6:** DTO: `sources` opcional con `@IsOptional() @ValidateNested()` y mensajes en español. Actualizar el espejo FE.
- [ ] **Step 7:** Commit `feat(conteo-manual): No VAN, guías dobles y elegir contra qué comparar`.

### Task 7: Conteo manual por zona + último conteo guardado

**Files:**
- Create: `src/consolidador/logic/zone-locate.util.ts` (+spec), `src/entities/manual-count-run.entity.ts`, migración `<N+1>-CreateManualCountRun.ts`
- Modify: `audit/manual-count.service.ts` (`diagnose` guarda el run; `diagnoseZone` nuevo), controller (`POST zone/:zoneId/:day/manual-count`, `POST zone/:zoneId/:day/manual-count/prompt` con el permiso de Task 1), `zone.types.ts`, module

**Interfaces:**
- Produces:
```ts
function locateGuides(tns: string[], candidates: { tn: string; subsidiaryId: string; kind: 'shipment' | 'charge' | 'novan' | 'collection'; createdAt: string; consDay: string | null }[], scopeIds: string[], day: string): { bySubsidiary: Map<string, string[]>; unlocated: string[] }
interface ZoneManualCountReport { zoneId: string; reports: ManualCountReport[]; unlocated: DiagnosisRow[] }
// tabla manual_count_run: id uuid, subsidiaryId, scope varchar(8), fromDay date, toDay date, counted int, matched int, differences int, missingAmount decimal(12,2), extraAmount decimal(12,2), createdById varchar null, createdAt datetime
ManualCountService.diagnoseZone(zoneId: string, user, day: string, lists: ManualLists, scope: ManualCountScope): Promise<ZoneManualCountReport>
```

- [ ] **Step 1: Tests de `locateGuides`:**
  - `guía solo en B → bySubsidiary B`
  - `guía en A (createdAt 01-oct) y B (createdAt 14-oct), day 15-oct → B` (la vigente, mismo criterio que `pickShipmentRowForDay`)
  - `guía en C, que no está en la zona → unlocated`
  - `ninguna guía sale en dos sucursales`
- [ ] **Step 2–4:** FAIL → implementar (reusar `pickShipmentRowForDay` si su firma alcanza) → PASS.
- [ ] **Step 5:** Entidad + migración de `manual_count_run` (índice `(subsidiaryId, toDay)`). `diagnose(...)` recibe `userId` opcional y, al terminar, inserta un renglón: `counted` = guías contadas, `matched` = `byVerdict.CUADRA`, `differences` = el resto, `missingAmount`/`extraAmount` = suma de `cost` de las filas `COBRO_FALTANTE`/`NOVAN_SIN_COBRO` y `COBRO_DE_MAS`/`DUPLICADO`/`DOBLE_PAQUETE_CARGA`. Si falla el insert solo se loguea; nunca rompe el diagnóstico.
- [ ] **Step 6:** `diagnoseZone`: `ZoneService.subsidiariesOf`, luego una query de candidatos por guía en `shipment`, `charge_shipment`, `collection` y `shipment_not_in_files` limitada a esas sucursales, luego `locateGuides`. Por cada sucursal (`runWithLimit` 2) corre `diagnose(subId, day, listasDeEsaSucursal, scope)`. Hay que correrlo también para las sucursales sin guías pegadas, porque su "cobrado y no lo contó" cuenta. Las `unlocated` salen como filas `NO_EXISTE` armadas con `diagnoseGuide` y facts vacíos.
- [ ] **Step 7:** Correr las migraciones en local. Probar con curl en la zona de Cabo: cada guía cae en un solo reporte.
- [ ] **Step 8:** Commit `feat(conteo-manual): pegar el conteo de toda la zona y guardar el último resultado`.

### Task 8: Resumen por sucursal

**Files:**
- Create: `src/consolidador/logic/summary-issue.util.ts` (+spec), `src/consolidador/read/summary.service.ts`
- Modify: controller (`GET :subsidiaryId/:fromDate/:toDate/summary`, `view='summary'`), `zone.types.ts`, module

**Interfaces:**
- Consumes: `read.getWeek`, `cobrosAudit.audit`, `ChargeGuidesService.report`, `CollectionsAuditService.report`, `NoVanAuditService.report`, `manual_count_run`.
- Produces:
```ts
interface SubsidiarySummary {
  incomeTotal: number; packages: number; charges: number;
  missing: { count: number; amount: number }; extra: { count: number; amount: number };
  doubles: number; collections: { registered: number; charged: number }; novan: { total: number; charged: number };
  lastManualCount: { differences: number; createdAt: string; scope: 'day' | 'week' } | null;
  topIssue: string; level: 'bad' | 'warn' | 'ok' | 'none';
}
function buildTopIssue(s: Omit<SubsidiarySummary, 'topIssue' | 'level'>, fmtMoney: (n: number) => string): { topIssue: string; level: SubsidiarySummary['level'] }
```
- `missing` = faltantes de cobros-audit + No VAN `sin_cobro` + recolecciones `sin_cobro`. `extra` = sobrantes de cobros-audit + dobles `overcharged`. Los montos de No VAN y recolecciones usan `fedexCostPackage` y el costo de recolección de la sucursal.

- [ ] **Step 1: Tests de `buildTopIssue`:**
  - `missing.amount 3904 (32) mayor que extra → level 'bad', "32 guías faltan por cobrar ($3,904)"`
  - `solo doubles 23 → level 'bad', "23 guías cobradas como paquete y como carga"`
  - `solo 2 recolecciones sin cobro → level 'warn', "2 recolecciones sin cobro"`
  - `todo en cero y lastManualCount null → level 'none', "Falta pegar el conteo manual"`
  - `todo en cero y conteo con 0 diferencias → level 'ok', "Nada pendiente"`
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** `SummaryService.forSubsidiary(id, from, to)`: corre las 5 fuentes en secuencia (no en paralelo, para cuidar la BD) y toma el último `manual_count_run` cuyo `toDay` cae en la semana.
- [ ] **Step 6:** Verificar que en local `incomeTotal` de una sucursal es igual al `buckets.total.amount` de la pestaña Ingresos de esa misma semana.
- [ ] **Step 7:** Commit `feat(consolidador): resumen de la semana por sucursal`.

### Task 9: FE — alcance, servicios y hook único

**Files (app-pmy):**
- Create: `lib/types/consolidador-zone.ts` (espejo de `zone.types.ts`), `lib/consolidador/scope.ts` + `scope.test.ts`, `lib/consolidador/zone-merge.ts` + `zone-merge.test.ts`, `hooks/services/consolidador/use-scoped-view.ts`
- Modify: `lib/services/consolidador.ts`

**Interfaces:**
- Produces:
```ts
type ScopeMode = 'zone' | 'subsidiary';
interface ConsolidadorScope { mode: ScopeMode; zoneId: string; subsidiaryId: string; focusSubsidiaryId: string | null }
function scopeReady(s: ConsolidadorScope): boolean
function loadScope(): ConsolidadorScope; function saveScope(s: ConsolidadorScope): void   // localStorage 'consolidador.scope', con try/catch
function scopedUrl(s: ConsolidadorScope, from: string, to: string, view: ZoneView): string // 'consolidador/zone/{z}/{f}/{t}/{view}' o la ruta por sucursal ('week' → 'consolidador/{s}/{f}/{t}')
function focusParts<T>(parts: ZonePart<T>[], focus: string | null): ZonePart<T>[]
function flattenParts<T, R>(parts: ZonePart<T>[], pick: (d: T) => R[]): (R & { subsidiaryId: string; subsidiaryName: string })[]
function pillLevel(s: SubsidiarySummary | null): 'bad' | 'warn' | 'ok' | 'none'
useScopedView<T>(scope: ConsolidadorScope, from: string, to: string, view: ZoneView, active: boolean): { parts: ZonePart<T>[]; isLoading: boolean; mutate: () => Promise<unknown> }
// en modo sucursal: GET por sucursal y se envuelve como [{ subsidiaryId, subsidiaryName, data, error: null }]
// servicios nuevos: getZoneView, getChargeGuides, getCollectionsAudit, getNovanAudit, getSummary, prefetchFedex, diagnoseManualCountZone, getManualCountPromptZone
```
- [ ] **Step 1: Tests Vitest:**
  - `scopedUrl` en zona `'by-route'` → `consolidador/zone/z1/2026-10-12/2026-10-18/by-route`
  - `scopedUrl` sucursal `'week'` → `consolidador/s1/2026-10-12/2026-10-18`
  - `scopeReady` falso sin zona o sin sucursal
  - `focusParts` filtra por foco y con `null` deja todas
  - `flattenParts` agrega `subsidiaryName` y se salta las partes con `data null`
  - `pillLevel(null) → 'none'`
- [ ] **Step 2:** `npx vitest run lib/consolidador/scope.test.ts lib/consolidador/zone-merge.test.ts` → FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit (app-pmy) `feat(consolidador): alcance por zona en el front`.

### Task 10: FE — header, pastillas, buscador y pestañas nuevas

**Files:**
- Create: `components/consolidador/scope-switcher.tsx`, `subsidiary-pills.tsx`, `search-sheet.tsx`
- Modify: `app/finanzas/consolidador/page.tsx`

**Interfaces:**
- Consumes: Task 9; `useZones`, `SucursalSelector`, `SearchPackageView`, `AnomaliesDialog`, `DateRealignDialog`, `AddIncomeDialog`.
- Produces: `page.tsx` con `scope` en estado (`loadScope`/`saveScope`) y `TabKey = 'resumen' | 'conteo' | 'auditoria' | 'detalle'`, por defecto `'resumen'`.

- [ ] **Step 1:** `ScopeSwitcher` con props `{ scope, onChange }`: ToggleGroup Zona|Sucursal. En Zona, un `Select` de zonas `w-56` con la leyenda "N sucursales" (de `useSucursales`/subsidiaries filtradas por `zoneId`, como `sin44-report.tsx:92`). En Sucursal, `SucursalSelector` `w-56`.
- [ ] **Step 2:** `SubsidiaryPills` con props `{ parts: ZonePart<SubsidiarySummary>[]; focus: string | null; onFocus(id | null) }`: pastilla "Todas" + una por sucursal con el punto de color de `pillLevel`. Solo se muestra en modo zona.
- [ ] **Step 3:** `SearchSheet`: un `Sheet` lateral con `SearchPackageView` adentro. Lo abre el botón "Buscar guía o consolidado" del header y Ctrl+K (listener en `page.tsx`, con limpieza al desmontar).
- [ ] **Step 4:** Header compacto (`size="sm"`, sin wrap): ScopeSwitcher · Buscar · DropdownMenu "Más acciones" (Anomalías; Corregir fechas solo para globales; ambas usan `focusSubsidiaryId ?? subsidiaryId` y piden elegir sucursal si no hay ninguna) · "+ Agregar ingreso". En zona, `AddIncomeDialog` recibe `subsidiaryOptions` para elegir la sucursal; agregarle esa prop si no existe.
- [ ] **Step 5:** Pestañas: Resumen · Conteo manual (solo con `hasPermission(user, 'finanzas.consolidador.conteoManual')`) · Auditoría de cobros · Detalle. Se quitan las pestañas Buscar paquete, Por ruta, Por consolidado e Ingresos (pasan a Detalle en Task 12). Cuando falta elegir zona o sucursal: "Elige una zona o una sucursal para comenzar".
- [ ] **Step 6:** `npx tsc --noEmit 2>&1 | grep -E "consolidador"` → sin errores en archivos tocados.
- [ ] **Step 7:** Commit `feat(consolidador): header por zona, buscador y pestañas nuevas`.

### Task 11: FE — Resumen

**Files:** Create `components/consolidador/summary-view.tsx`; Modify `page.tsx`

**Interfaces:** Consumes `useScopedView<SubsidiarySummary>(scope, from, to, 'summary', active)`; `onFocus(subsidiaryId)`.

- [ ] **Step 1:** 5 KPIs de zona (sumas de las partes): Cobrado (con "N paquetes · M cargas"), Falta cobrar, Se cobró de más, Paquete y carga a la vez, No VAN ("X cobradas · Y sin cobro").
- [ ] **Step 2:** `DataTable` con una fila por sucursal y las columnas de la maqueta: Sucursal (con punto de color) · Cobrado · Falta cobrar (monto · guías) · De más · Paquete + carga · Recolecciones (cobradas / registradas) · No VAN · Conteo manual (badge "N diferencias" / "Cuadra" / "Sin conteo") · Qué revisar primero. Clic en la fila → `onFocus`. Una parte con `error` se muestra como fila con "No se pudo cargar esta sucursal" y un botón Reintentar.
- [ ] **Step 3:** Botón "Exportar a Excel" (xlsx, como `manual-count-export`).
- [ ] **Step 4:** tsc limpio. Commit `feat(consolidador): pestaña Resumen`.

### Task 12: FE — Auditoría con subpestañas y Detalle por sucursal

**Files:**
- Create: `components/consolidador/subsidiary-group.tsx`, `charge-guides-table.tsx`, `collections-audit-table.tsx`, `novan-table.tsx`
- Modify: `cobros-audit-panel.tsx`, `groups-view.tsx`, `page.tsx`

**Interfaces:**
- `SubsidiaryGroup` props `{ name: string; subtitle: string; error?: string | null; children }`: Collapsible con encabezado "Cabo San Lucas · 38 diferencias · −$3,904".
- Cada tabla recibe `parts: ZonePart<Report>[]` y `grouped: boolean`. Con `grouped`, un `SubsidiaryGroup` + `DataTable` por sucursal; si no, un solo `DataTable` con columna Sucursal filtrable (`flattenParts`).

- [ ] **Step 1:** `cobros-audit-panel.tsx`: 5 KPIs (los de la maqueta) y subpestañas Reglas de cobro · Cargas (badge "N dobles") · Recolecciones · No VAN (badge con el total). La tabla de reglas de hoy pasa a ser la subpestaña Reglas y se agrupa por sucursal.
- [ ] **Step 2:** `ChargeGuidesTable`: segmentado "Solo dobles | Todas" (por defecto Solo dobles). Columnas: Guía · Carga · Subida (quién · hora) · También como paquete (consolidado · hora) · Cobro del paquete (badge) · Acción "Anular cobro del paquete" con `ReasonButton` → `deleteIncome(packageIncome.incomeId, motivo)` → `mutate`.
- [ ] **Step 3:** `CollectionsAuditTable`: Guía · Registrada · FedEx recogido · Ruta · Cobro (badges en llano: "Cobrada $98", "Sin cobro", "No cobra (31.5)", "Cobrada dos veces"). Botón "Verificar con FedEx": lotes de 25 con `prefetchFedex` y `Progress`, luego `mutate`. "Generar cobro" (solo `sin_cobro` con FedEx recogido) → `createManualIncome({ subsidiaryId, kind: 'recoleccion', trackingNumber, cost, date: day, reason })`; el 409 se muestra como "Ya tiene cobro".
- [ ] **Step 4:** `NoVanTable`: Guía · Ruta / cierre (día · chofer · hora) · FedEx hoy · Cobro. Mismo botón "Verificar con FedEx". "Generar cobro" (solo `sin_cobro`) → `createManualIncome({ kind: suggestedKind, trackingNumber, date: routeDay, cost: fedexCostPackage, reason })`. `es_paquete` sale gris: "Ya existe como paquete".
- [ ] **Step 5:** Detalle: segmentado Por ruta | Por consolidado | Ingresos y, en zona, "Agrupar por sucursal | Todo junto". `GroupsView` recibe `parts` en lugar de `subsidiaryId` y se envuelve en `SubsidiaryGroup` por sucursal. La tabla de Ingresos usa `flattenParts` + columna Sucursal. Las acciones por fila (editar costo, fecha, borrar, historial) no cambian: trabajan por `income.id`.
- [ ] **Step 6:** tsc limpio. Commit `feat(consolidador): auditoría de cargas, recolecciones y No VAN; detalle por sucursal`.

### Task 13: FE — Conteo manual nuevo

**Files:** Modify `components/consolidador/manual-count-panel.tsx`, `manual-count-table.tsx`, `lib/services/consolidador.ts`

**Interfaces:** Consumes `diagnoseManualCountZone(zoneId, day, lists & { sources }, scope)` → `ZoneManualCountReport`. En modo sucursal se sigue usando `diagnoseManualCount` y se envuelve como `{ reports: [r], unlocated: [] }`.

- [ ] **Step 1:** Paso 1: título "1 · Pega lo que contó la persona" y el texto "Puedes pegar todo junto aunque sea de varias sucursales". Las 4 cajas en una fila con su contador, y la fila "Comparar también contra:" con Checkbox Cargas / Recolecciones / No VAN (todas prendidas) y el botón Comparar. El prefetch FedEx por bloques de 25 se queda como hoy.
- [ ] **Step 2:** Paso 2: 4 KPIs (Cuadra / Contó y no está cobrado / Cobrado y no lo contó / Error de conteo) y la leyenda de badges No VAN · Carga · Recolección · Doble (según `row.source` y `cause`). Tabla agrupada por sucursal con `SubsidiaryGroup` (+ grupo "Sin sucursal" para las `unlocated`). Columnas: Guía · Contó · Dónde está en el sistema (`row.where` + badge) · Qué pasó (`explanation`) · Monto · Acción. Acciones: `DOBLE_PAQUETE_CARGA` → "Anular cobro del paquete"; `NOVAN_SIN_COBRO` → "Generar cobro" (alta manual); las demás, como hoy. El filtro "Con diferencia" sigue siendo el de entrada (`VerdictTiles`).
- [ ] **Step 3:** El Excel y el prompt siguen funcionando: el Excel lleva columna Sucursal y el prompt se pide por sucursal (botón en el encabezado de cada grupo).
- [ ] **Step 4:** tsc limpio. Commit `feat(conteo-manual): pantalla nueva por zona con cargas, recolecciones y No VAN`.

### Task 14: Verificación completa y cierre

- [ ] **Step 1:** BE: `npx jest src/consolidador` → todo verde. FE: `npx vitest run lib/consolidador` → verde.
- [ ] **Step 2:** `npx tsc --noEmit` en ambos repos: sin errores nuevos en archivos tocados.
- [ ] **Step 3:** Navegador (ojo con el OOM de 8 GB; si `next dev` se cae, reiniciarlo, nunca subir `max-old-space`). Revisar:
  - Zona con Cabo: Resumen con una fila por sucursal; clic → pastilla activa.
  - Auditoría → Cargas muestra las dobles de Cabo.
  - No VAN muestra las de la semana.
  - Conteo manual pegando guías de dos sucursales: cada una cae en su grupo.
  - Un usuario sin el permiso nuevo no ve la pestaña.
  - Capturas como prueba.
- [ ] **Step 4:** `graphify update .` en pmy-api.
- [ ] **Step 5:** Actualizar la memoria del proyecto (archivo nuevo `consolidador-por-zona.md` + una línea en MEMORY.md) con ramas, migraciones pendientes en prod y lo que quedó sin verificar.
- [ ] **Step 6:** Pedir al usuario el OK para merge a main + push (regla de la casa).
