# Cierre de ruta: "Paquetes con problema" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, decisión del usuario). Steps usan `- [ ]`.

**Goal:** Panel solo-superadmin en el cierre de ruta que diagnostica contra FedEx los paquetes con
estatus/historial/ingreso inconsistente, explica cada caso y aplica los arreglos elegidos.

**Architecture:** Lógica de decisión pura (`closure-doctor.util.ts`) alimentada por un snapshot
(FedEx ya normalizado + historial + ingresos + datos de la salida). `TrackingCompareService`
expone un snapshot FedEx sin persistir (pipeline con y sin escudos). `ClosureDoctorService`
hace el I/O: diagnostica la ruta y aplica por paquete en transacción, re-diagnosticando y
comparando huella. Front: panel en el wizard de cierre.

**Tech Stack:** NestJS + TypeORM (MySQL) + Jest · Next.js + shadcn + Tailwind + Vitest.

## Global Constraints

- Solo superadmin: `@UseGuards(SuperAdminGuard)` en ambos endpoints; botón oculto en el front
  para roles fuera de `["superadmin", "superamin"]`.
- Cargas F2 y rutas `is315` **nunca** generan ingreso; rutas `is315` solo diagnostican cargas.
- Fecha del ingreso = instante real del evento FedEx (aunque sea de semana pasada) + aviso.
- No se degrada un estatus final (ENTREGADO/DEVUELTO_A_FEDEX/RETORNO_ABANDONO_FEDEX) a otro
  estatus: eso es WARNING, no arreglo.
- No se cambia el cron, el motor tracking-sync automático ni `reconcileRouteWithFedex`.
- Textos visibles en español llano; UI solo shadcn + Tailwind, densa (un renglón por paquete).
- Ingresos existentes se leen con `active = true`.

---

### Task 1: Lógica pura `diagnosePackage`

**Files:**
- Create: `src/routeclosure/closure-doctor.util.ts`
- Test: `src/routeclosure/closure-doctor.util.spec.ts`

**Interfaces (Produces):**

```ts
export type DoctorProblemCode =
  | 'STATUS_BEHIND' | 'DELIVERED_BEFORE_ROUTE' | 'HISTORY_MISSING' | 'INCOME_MISSING' | 'WARNING';

export interface DoctorEvent { occurredAt: Date; status: ShipmentStatusType; exceptionCode: string | null;
  description: string | null; location: string | null; shadowKey: string; vetoed: boolean; }

export interface DoctorInput {
  entity: { id: string; trackingNumber: string; kind: 'shipment' | 'charge'; status: ShipmentStatusType };
  fedex: null | {            // null = FedEx sin datos / error
    events: DoctorEvent[];   // asc
    shieldedStatus: ShipmentStatusType | null; // pipeline completo
    rawStatus: ShipmentStatusType | null;      // pipeline sin time-shield/terminal-lock
    headerDeliveredAt: Date | null;
  };
  fedexError?: string | null;
  historyRows: { status: ShipmentStatusType; exceptionCode: string | null; timestamp: Date; shadowKey: string }[];
  incomes: { id: string; incomeType: IncomeStatus; date: Date }[];   // SHIPMENT, active
  dispatch: { routeDate: Date | null; createdAt: Date | null; is315: boolean; cost: number };
}

export interface DoctorEventToInsert { occurredAt: string; status: ShipmentStatusType;
  exceptionCode: string | null; description: string | null; shadowKey: string; }

export interface DoctorIncomePlan { type: 'create' | 'supersede'; incomeId?: string;
  incomeType: IncomeStatus; nonDeliveryStatus: string | null; date: string; cost: number; pastWeek: boolean; }

export interface PackageDiagnosis {
  shipmentId: string; trackingNumber: string; kind: 'shipment' | 'charge';
  currentStatus: ShipmentStatusType; targetStatus: ShipmentStatusType | null;
  fedexEventAt: string | null; problems: DoctorProblemCode[];
  plan: null | { setStatus: ShipmentStatusType | null; insertEvents: DoctorEventToInsert[]; income: DoctorIncomePlan | null };
  explanation: string[]; fingerprint: string | null;
}

export function diagnosePackage(input: DoctorInput): PackageDiagnosis;
export function isOutcomeStatus(s: ShipmentStatusType | null): boolean;
```

**Reglas:**
1. `fedex === null` → `WARNING` ("FedEx no regresó datos…"), sin plan.
2. Target: si `rawStatus` es desenlace (`isOutcomeStatus`: TERMINAL_SHIPMENT_STATUSES ∪
   {RECHAZADO, CLIENTE_NO_DISPONIBLE, DIRECCION_INCORRECTA, CAMBIO_FECHA_SOLICITADO, NO_ENTREGADO})
   → `target = rawStatus`; si no → `target = shieldedStatus`. (Evita regresar EN_RUTA→EN_BODEGA.)
3. Estatus actual final y `target !== current` → `WARNING` ("estatus final, revisar a mano").
4. Evento respaldo = último evento con `status === target` (ENTREGADO también acepta
   ENTREGADO_POR_FEDEX). `fedexEventAt` = su `occurredAt` o `headerDeliveredAt` si target ENTREGADO.
5. `target !== current` → `STATUS_BEHIND`; si target ∈ {ENTREGADO, DEVUELTO_A_FEDEX} y
   día Hermosillo(evento) < día ruta → además `DELIVERED_BEFORE_ROUTE`.
   Inserta: eventos FedEx faltantes (shadowKey no conocido) no vetados + el evento respaldo
   aunque esté vetado; el evento respaldo se inserta con `status = target`.
6. `target === current` y ninguna fila de historial con `status === target` y existe evento
   respaldo → `HISTORY_MISSING`, inserta solo el evento respaldo.
7. Ingreso (solo `kind==='shipment'` y `!is315`): `noVanIncomeDecision` (delivered = target
   ENTREGADO; dexCode = exceptionCode del respaldo si target ∈ cobrables no-entrega; dex08Dates =
   filas 08 + eventos 08 a insertar) → `reconcileShipmentIncomeAction` → si create/supersede →
   `INCOME_MISSING` con `date = fedexEventAt`, `pastWeek = lunes(evento) < lunes(día ruta)`.
8. Ingreso ENTREGADO existente y target no es ENTREGADO → `WARNING` ("cobrado como entregado
   pero FedEx dice …; revisar en el Consolidador").
9. `fingerprint` = sha1(JSON estable de `plan`) o null sin plan.
10. Explicación: renglones en llano con fechas `dd-mmm HH:mm` Hermosillo.

- [ ] Step 1: escribir specs (casos: sin FedEx; Loreto 30-sep vs ruta 06-oct con ingreso
  fechado 30-sep y pastWeek; historial faltante con ENTREGADO actual; F2 sin ingreso; is315 sin
  ingreso; ingreso ENTREGADO existente de otra ruta → sin INCOME_MISSING; DEX mismo día →
  supersede; 08 sin 3 visitas → sin ingreso; final degradado → WARNING; EN_RUTA vs EN_BODEGA
  shielded → sin problema; fingerprint estable).
- [ ] Step 2: `npx jest src/routeclosure/closure-doctor.util.spec.ts` → FAIL.
- [ ] Step 3: implementar.
- [ ] Step 4: correr → PASS.
- [ ] Step 5: commit `feat(cierre): diagnostico puro de paquetes con problema`.

### Task 2: Snapshot FedEx sin persistir en `TrackingCompareService`

**Files:** Modify `src/tracking-sync/sync-rules.pipeline.ts` (`run(ctx, opts?: { skip?: string[] })`),
`src/tracking-sync/tracking-compare.service.ts` (nuevo `buildDoctorSnapshot`, `listRouteItems`).

**Produces:**
```ts
async listRouteItems(routeId: string, kinds?: TrackableKind[]): Promise<{ entity: Trackable; kind: TrackableKind }[]>;
async buildDoctorSnapshot(entity: Trackable, kind: TrackableKind): Promise<null | {
  events: NormalizedEvent[]; vetoedEventKeys: Set<string>;
  shieldedStatus: ShipmentStatusType | null; rawStatus: ShipmentStatusType | null; headerDeliveredAt: Date | null; }>;
```
`rawStatus`: segundo pase del pipeline sobre un ctx nuevo con `skip: ['time-shield','terminal-lock']`.

- [ ] Step 1: test en `sync-rules.pipeline.spec.ts` (regla en skip no corre) → FAIL → implementar → PASS.
- [ ] Step 2: implementar `buildDoctorSnapshot` reutilizando la preparación de `buildContext`
  (extraer `prepareContext` sin pipeline).
- [ ] Step 3: `npx jest src/tracking-sync` → PASS; commit.

### Task 3: `ClosureDoctorService` + endpoints

**Files:** Create `src/routeclosure/closure-doctor.service.ts`, `src/routeclosure/dto/apply-closure-fixes.dto.ts`,
test `src/routeclosure/closure-doctor.service.spec.ts`; Modify `routeclosure.module.ts`, `routeclosure.controller.ts`.

- `diagnoseRoute(dispatchId)` → `{ dispatchId, is315, routeDay, subsidiaryName, packages: PackageDiagnosis[] }`
  (solo con problemas; concurrencia 6).
- `applyFixes(dispatchId, items, actor)` → `{ results: { shipmentId, kind, trackingNumber, status: 'applied'|'changed'|'error'|'nothing', message }[] }`.
  Por item: re-diagnostica; huella distinta → `changed`; si igual → transacción: inserta eventos
  (dedupe shadowKey dentro de TX), actualiza estatus, crea/actualiza Income
  (`createdById = actor.userId`).
- Controller: `POST :packageDispatchId/diagnose` (`@NoAudit`) y `POST :packageDispatchId/apply-fixes`,
  ambos `@UseGuards(SuperAdminGuard)`; declarar ANTES de `@Get(':id')` no aplica (son POST).
- [ ] Spec: huella distinta → `changed` sin escribir; error en un paquete no frena al otro.
- [ ] `npx jest src/routeclosure` + `npx tsc --noEmit -p tsconfig.json` → limpio; commit.

### Task 4: Front (app-pmy)

**Files:** Modify `lib/services/route-closure.ts` (`diagnoseClosure`, `applyClosureFixes` + tipos),
create `components/package-dispatch/closure-doctor-panel.tsx`, modify
`components/package-dispatch/close-package-dispatch-form.tsx` (botón superadmin en el header del
wizard + recarga de la salida tras aplicar, sin re-reconciliar).

- Panel en `Dialog`: carga → lista densa (Checkbox, guía, Paquete/Carga F2, pastillas,
  actual → propuesto, expandible con explicación). Solo WARNING: sin checkbox.
- "Aplicar seleccionados" → `AlertDialog` con resumen (estatus, eventos, ingresos y monto,
  cuántos en semana pasada) → resultados por paquete → re-diagnóstico + `onApplied()`.
- [ ] `npx tsc --noEmit` y `npx vitest run lib/tracking` limpios; probar en navegador; commit.

### Task 5: Cierre

- [ ] `graphify update .` en pmy-api; memoria del proyecto; resumen al usuario.
