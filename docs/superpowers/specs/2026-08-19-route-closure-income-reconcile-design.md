# Reconciliación de ingresos en el cierre a ruta

Fecha: 2026-08-19
Estado: IMPLEMENTADO (commit inline; ver `income-reconcile.util.ts` + `RouteclosureService.reconcileRouteIncome`)

## Contexto y problema

El cierre a ruta ya reconcilia y persiste el ÚLTIMO estatus FedEx de las guías al abrir
(`RouteclosureService.reconcileRouteWithFedex` → `TrackingCompareService.applyByRoute`,
status-only). Pero esa reconciliación **no toca ingresos**, y el análisis de los flujos de
`Income` reveló huecos:

- **DEX sin ingreso:** el income de un shipment FedEx se genera en `processMasterFedexUpdate`
  (`shipments.service.ts`), pero un evento DEX del mismo día previo al `createdAt` del shipment
  se filtra (candado pre-registro) en sucursales sin `allowSameDayPreRegistrationFedexEvents`.
  A diferencia de ENTREGADO (que tiene "safety net" por header `DL`), **el DEX no tiene
  respaldo** → su ingreso puede quedar faltante para siempre.
- **Conflicto DEX→ENTREGADO:** `generateIncomes` deduplica por `(trackingNumber, incomeType,
  semana)`. Como un DEX (incomeType=NO_ENTREGADO) y una entrega (incomeType=ENTREGADO) tienen
  distinto `incomeType`, una guía que tuvo DEX07 y luego se entregó el mismo día puede quedar
  con DOS ingresos. Debe ganar ENTREGADO.
- **F2/charge:** por regla de negocio, las cargas nunca generan ingreso por paquete.

Decisión (confirmada con el usuario): esta lógica vive **en el cierre a ruta**, dentro del
mismo reconcile al abrir. No se arregla el sync legacy (queda como TODO en
`processMasterFedexUpdate`/`processChargeFedexUpdate`).

## Objetivo

Que al abrir el cierre, además de corregir el estatus, el reconcile **corrija los ingresos**
de los shipments de la ruta: backfill de faltantes y precedencia ENTREGADO > DEX, de forma
idempotente y sin llamadas extra a FedEx.

## Reglas de negocio

1. **Solo `shipment`**: los `charge_shipment`/F2 nunca tocan ingresos (se saltan).
2. **`is315` ⇒ NO se revisa nada de ingresos**: return temprano (consistente con No VAN y
   recolecciones en rutas 31.5, que tampoco cobran).
3. **Precedencia ENTREGADO > DEX**: si una guía tiene un ingreso de DEX (NO_ENTREGADO) y FedEx
   ahora la reporta ENTREGADA:
   - **mismo día calendario Hermosillo** (día del `Income` DEX == día del evento de entrega) →
     el ingreso de ENTREGADO **reemplaza** al del DEX **actualizando la fila existente** en su
     lugar (`incomeType→ENTREGADO`, `nonDeliveryStatus→null`, `date→inicio de día Hermosillo de
     la entrega`).
   - **días distintos** → se **conserva** el ingreso del DEX y se **crea** el de ENTREGADO
     (son dos eventos de servicio; `charge_rule` decide qué cuenta en lectura).
4. **ENTREGADO nunca se degrada**: si ya existe un ingreso ENTREGADO y FedEx reporta un DEX,
   no se hace nada.
5. **Backfill**: si no existe ningún ingreso para la guía y FedEx la reporta cobrable
   (ENTREGADO o DEX resuelto), se crea el ingreso.
6. **Costo**: `subsidiary.fedexCostPackage`; si es 0 se registra el ingreso en $0 y se loguea
   `FINANCE_ERROR` (consistente con el resto del cierre).
7. **Idempotente**: correr el reconcile N veces deja el mismo resultado.

Nota de consistencia: qué DEX cobra se decide con el MISMO criterio que los No VAN del cierre
(`noVanIncomeDecision`: cualquier DEX resuelto cobra como NO_ENTREGADO; entregado cobra como
ENTREGADO; en tránsito/sin resolver no cobra). NO se replica la regla "08 en 3ª visita" del
sync legacy — el cierre ya diverge de eso hoy vía No VAN, y `charge_rule`/`isCountableIncome`
decide la contabilidad final en lectura.

## Fuente de verdad (sin segunda llamada a FedEx)

`applyByRoute` (tracking-sync) ya consulta FedEx por guía y calcula el estatus canónico y el
último evento. Para evitar una segunda llamada, se **extiende `ApplyOutcome`** con:

- `kind: 'shipment' | 'charge'` (para saltar charges)
- `exceptionCode: string | null` (del último evento normalizado)
- `eventAt: string | null` (ISO del último evento normalizado)

Estos campos se derivan del `SyncContext` que ya existe en `PersistentSyncSink.applyPlan`
(`ctx.kind`, `ctx.normalized.latest`). El income reconcile del cierre consume estos outcomes.

## Arquitectura y componentes

### 1. Función pura de decisión (nueva)

`reconcileShipmentIncomeAction(input): IncomeReconcileAction` en
`src/routeclosure/income-reconcile.util.ts`.

Entrada:
```ts
interface IncomeReconcileInput {
  decision: NoVanIncomeFields | null;   // reuso de noVanIncomeDecision: {incomeType, nonDeliveryStatus} | null
  deliveryDay: string | null;           // día Hermosillo (YYYY-MM-DD) del evento FedEx cobrable
  existing: {                           // ingresos SHIPMENT actuales de la guía
    entregado: boolean;
    dex?: { id: string; day: string };  // primer Income NO_ENTREGADO (id + día Hermosillo de su date)
  };
}
```
Salida:
```ts
type IncomeReconcileAction =
  | { type: 'none' }
  | { type: 'create'; incomeType: IncomeStatus; nonDeliveryStatus: string | null }
  | { type: 'supersede'; incomeId: string };   // actualiza la fila DEX a ENTREGADO
```
Lógica (pura, sin I/O) — el ORDEN importa:
- `decision == null` → `none`.
- `decision.incomeType == ENTREGADO`:
  1. ya existe ENTREGADO → `none` (idempotente; evita ENTREGADO duplicado aunque haya un DEX
     rezagado del mismo día — ese DEX no se toca aquí para no borrar filas).
  2. existe DEX y `existing.dex.day == deliveryDay` → `supersede(existing.dex.id)`.
  3. si no → `create(ENTREGADO, null)` (backfill, o cross-day con DEX de otro día: el DEX se
     conserva y se crea el ENTREGADO).
- `decision.incomeType == NO_ENTREGADO`:
  1. ya existe ENTREGADO → `none` (no degradar).
  2. ya existe DEX (mismo) → `none` (idempotente).
  3. si no → `create(NO_ENTREGADO, dexCode)` (backfill).

### 2. Aplicación en el servicio

`RouteclosureService.reconcileRouteIncome(dispatch, outcomes, actor)` (privado, llamado desde
`reconcileRouteWithFedex` tras `applyByRoute`):
- Si `dispatch.is315` → return (no toca ingresos).
- Filtra `outcomes` a `kind === 'shipment'`.
- Por guía: deriva `decision` con `noVanIncomeDecision` a partir de un `NoVanFedexOutcome`
  construido desde el outcome (`delivered = toStatus es ENTREGADO`, `dexCode = exceptionCode`
  si el estatus es no-entregado, `resolved = true`). `deliveryDay = toHermosilloDateString(eventAt)`.
- Carga los `Income` SHIPMENT existentes de la guía y arma `existing`.
- Llama `reconcileShipmentIncomeAction` y aplica: `create` → nuevo `Income`; `supersede` →
  update de la fila; `none` → nada. Todo en una transacción por lote de guías.
- Logs `FINANCE_ERROR` si `fedexCostPackage <= 0`.

`reconcileRouteWithFedex` devuelve, además de lo actual, un resumen de ingresos
(`incomeCreated`, `incomeSuperseded`).

## Flujo de datos

Abrir cierre → `POST route-closure/reconcile/:dispatchId` → `reconcileRouteWithFedex`:
1. `applyByRoute(dispatchId, actor, {kinds})` persiste estatus (shipments+F2, o solo F2 si is315)
   y devuelve `ApplyOutcome[]` (ahora con `kind`/`exceptionCode`/`eventAt`).
2. `reconcileRouteIncome(dispatch, outcomes, actor)` aplica las reglas de ingresos (solo si NO
   es 315; solo shipments).
3. Devuelve resumen `{ updated, incomeCreated, incomeSuperseded, ... }`.

## Manejo de errores

- El reconcile de ingresos **no debe romper la apertura del cierre**: si una guía falla, se
  loguea y se continúa (mismo criterio que `applyByRoute`).
- Costo 0 → ingreso en $0 + `FINANCE_ERROR` (no se aborta).
- `date` de todo ingreso nuevo/actualizado se ancla a inicio de día Hermosillo (bucket correcto
  del dashboard), igual que el resto del cierre.

## Pruebas (unitarias, Jest)

Función pura `reconcileShipmentIncomeAction` (`income-reconcile.util.spec.ts`):
- decision null → none.
- ENTREGADO + DEX mismo día (sin ENTREGADO previo) → supersede(id).
- ENTREGADO + DEX día distinto → create(ENTREGADO).
- ENTREGADO + ya ENTREGADO → none.
- ENTREGADO + ya ENTREGADO + DEX rezagado mismo día → none (no duplica ENTREGADO).
- ENTREGADO sin ingresos → create(ENTREGADO) (backfill).
- DEX sin ingresos → create(NO_ENTREGADO, code) (backfill).
- DEX + ya ENTREGADO → none (no degrada).
- DEX + mismo DEX → none (idempotente).

Flujo `reconcileRouteIncome` (extensión de `routeclosure.closure-fixes.spec.ts`):
- backfill crea Income SHIPMENT con costo de sucursal.
- supersede actualiza la fila DEX → ENTREGADO, limpia nonDeliveryStatus.
- cross-day conserva DEX y crea ENTREGADO.
- skip de `charge` (no toca ingresos de F2).
- `is315` → no toca ningún ingreso.

Extensión de `tracking-compare.service.spec.ts`: `ApplyOutcome` incluye `kind`/`exceptionCode`/`eventAt`.

## Fuera de alcance (YAGNI)

- No se arregla el sync legacy `processMasterFedexUpdate`/`processChargeFedexUpdate` (queda el
  TODO ya colocado).
- No se replica la regla "08 en 3ª visita".
- No se generan ingresos para F2/charge.
- No se toca la contabilidad de lectura (`charge_rule`/`kpi.service`): sigue decidiendo qué
  cuenta.
