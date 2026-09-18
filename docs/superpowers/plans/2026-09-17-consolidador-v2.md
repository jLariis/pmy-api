# Consolidador v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar el Consolidador en 4 pestañas (Por ruta, Por consolidado, Buscar paquete, Auditoría) con tarjetas plegables de KPIs y un motor de veredicto que decide si un "entregado por FedEx" en realidad lo entregamos nosotros.

**Architecture:** BE NestJS/TypeORM: un util puro de veredicto + un servicio de lectura agrupada que reusa `CobrosAuditService`; se enriquece el `status` service con ruta/consolidado. FE Next/React: 4 pestañas con tarjetas plegables y una sección de búsqueda (ya no modal), rediseñada con shadcn.

**Tech Stack:** NestJS, TypeORM (MySQL), Jest (BE) · Next.js, React, SWR, shadcn/ui, Tailwind, Vitest (FE).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-17-consolidador-v2-vista-por-ruta-verdict-design.md`.
- Sin migraciones ni columnas nuevas: todo se deriva de datos existentes.
- FE: toda pantalla dentro de `AppLayout` + `withAuth("finanzas.consolidador")` + `OperationHeader`; SOLO shadcn (`@/components/ui/*`) + Tailwind; nada de HTML crudo.
- Coincidencia de fecha ruta↔ingreso: **mismo día exacto** (`toISOString().slice(0,10)`).
- "Entregado" = `ENTREGADO`, `ENTREGADO_EN_BODEGA`, `ENTREGADO_POR_FEDEX`.
- Regla de la casa: al tocar un archivo, dejar `tsc`/lint/tests de ese archivo sin errores.
- Repos: `C:\PMY\pmy-api` (BE) y `C:\PMY\app-pmy` (FE), rama `feat/consolidador-v2` en ambos.
- Tras cambios de BE: `graphify update .`.

---

### Task 1: Motor de veredicto (BE, util puro)

**Files:**
- Create: `src/consolidador/logic/package-verdict.util.ts`
- Test: `src/consolidador/logic/package-verdict.util.spec.ts`

**Interfaces:**
- Consumes: `ShipmentStatusType` de `../../common/enums/shipment-status-type.enum`.
- Produces:
  ```ts
  export type VerdictLevel = 'ok' | 'warn' | 'danger';
  export type VerdictCode =
    | 'delivered_by_us' | 'fedex_delivery_doubtful' | 'our_delivery_ok'
    | 'no_income_ok' | 'date_mismatch' | 'income_without_support'
    | 'status_regressed' | 'unverified';
  export type SuggestedAction =
    | { kind: 'none' }
    | { kind: 'fix_status'; to: ShipmentStatusType }
    | { kind: 'delete_income' };
  export interface Verdict {
    code: VerdictCode; level: VerdictLevel; title: string;
    evidence: string[]; suggestedAction: SuggestedAction;
  }
  export interface VerdictInput {
    currentStatus: ShipmentStatusType | null;
    history: Array<{ status: string | null; timestamp: Date | string | null }>;
    hasConsolidado: boolean;
    routeDate: Date | string | null;
    incomeDate: Date | string | null;
    fedexVerified: boolean; // false → no se pudo confirmar contra FedEx
  }
  export function computeVerdict(input: VerdictInput): Verdict;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/consolidador/logic/package-verdict.util.spec.ts
import { computeVerdict } from './package-verdict.util';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

const base = {
  currentStatus: null,
  history: [] as Array<{ status: string | null; timestamp: Date | string | null }>,
  hasConsolidado: false,
  routeDate: null as Date | string | null,
  incomeDate: null as Date | string | null,
  fedexVerified: true,
};

describe('computeVerdict', () => {
  it('entregado por fedex + ruta el mismo día del ingreso → delivered_by_us (ok, fix a ENTREGADO)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      hasConsolidado: true,
      routeDate: '2026-09-17T00:00:00.000Z',
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('delivered_by_us');
    expect(v.level).toBe('ok');
    expect(v.suggestedAction).toEqual({ kind: 'fix_status', to: ShipmentStatusType.ENTREGADO });
  });

  it('entregado por fedex con ingreso y sin ruta ese día → fedex_delivery_doubtful (danger, borrar)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      routeDate: null,
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('fedex_delivery_doubtful');
    expect(v.level).toBe('danger');
    expect(v.suggestedAction).toEqual({ kind: 'delete_income' });
  });

  it('entregado por fedex con ruta en día distinto al ingreso → fedex_delivery_doubtful', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      routeDate: '2026-09-16T00:00:00.000Z',
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('fedex_delivery_doubtful');
  });

  it('entregado por fedex sin FedEx confirmado → unverified (warn, sin acción)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO_POR_FEDEX,
      incomeDate: '2026-09-17T15:00:00.000Z',
      fedexVerified: false,
    });
    expect(v.code).toBe('unverified');
    expect(v.level).toBe('warn');
    expect(v.suggestedAction).toEqual({ kind: 'none' });
  });

  it('entrega nuestra normal con ingreso → our_delivery_ok', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO,
      history: [{ status: ShipmentStatusType.ENTREGADO, timestamp: '2026-09-17T15:00:00.000Z' }],
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('our_delivery_ok');
    expect(v.level).toBe('ok');
  });

  it('ingreso fechado en día sin evento → date_mismatch (warn)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.ENTREGADO,
      history: [{ status: ShipmentStatusType.ENTREGADO, timestamp: '2026-09-15T15:00:00.000Z' }],
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('date_mismatch');
    expect(v.level).toBe('warn');
  });

  it('cobro sin evento terminal que lo respalde → income_without_support (danger)', () => {
    const v = computeVerdict({
      ...base,
      currentStatus: ShipmentStatusType.EN_RUTA,
      history: [{ status: ShipmentStatusType.EN_RUTA, timestamp: '2026-09-17T15:00:00.000Z' }],
      incomeDate: '2026-09-17T15:00:00.000Z',
    });
    expect(v.code).toBe('income_without_support');
    expect(v.level).toBe('danger');
  });

  it('sin ingreso → no_income_ok (ok)', () => {
    const v = computeVerdict({ ...base, currentStatus: ShipmentStatusType.EN_RUTA });
    expect(v.code).toBe('no_income_ok');
    expect(v.level).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/consolidador/logic/package-verdict.util.spec.ts`
Expected: FAIL ("Cannot find module './package-verdict.util'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/consolidador/logic/package-verdict.util.ts
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

export type VerdictLevel = 'ok' | 'warn' | 'danger';
export type VerdictCode =
  | 'delivered_by_us' | 'fedex_delivery_doubtful' | 'our_delivery_ok'
  | 'no_income_ok' | 'date_mismatch' | 'income_without_support'
  | 'status_regressed' | 'unverified';
export type SuggestedAction =
  | { kind: 'none' }
  | { kind: 'fix_status'; to: ShipmentStatusType }
  | { kind: 'delete_income' };
export interface Verdict {
  code: VerdictCode; level: VerdictLevel; title: string;
  evidence: string[]; suggestedAction: SuggestedAction;
}
export interface VerdictInput {
  currentStatus: ShipmentStatusType | null;
  history: Array<{ status: string | null; timestamp: Date | string | null }>;
  hasConsolidado: boolean;
  routeDate: Date | string | null;
  incomeDate: Date | string | null;
  fedexVerified: boolean;
}

const TERMINAL = new Set<string>([
  ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA, ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
]);
const dayKey = (d: Date | string | null): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

const isFedexDelivered = (i: VerdictInput): boolean =>
  i.currentStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX ||
  (i.history || []).some((h) => h.status === ShipmentStatusType.ENTREGADO_POR_FEDEX);

export function computeVerdict(i: VerdictInput): Verdict {
  const hasIncome = !!i.incomeDate;
  const terminalEvents = (i.history || []).filter((h) => h.status && TERMINAL.has(String(h.status)));
  const currentTerminal = i.currentStatus ? TERMINAL.has(String(i.currentStatus)) : false;

  // Entregado por FedEx: veredicto especial (#2).
  if (isFedexDelivered(i) && hasIncome) {
    if (!i.fedexVerified) {
      return {
        code: 'unverified', level: 'warn',
        title: 'Sin verificar contra FedEx',
        evidence: ['No se pudo confirmar el estatus con FedEx; revisa manualmente.'],
        suggestedAction: { kind: 'none' },
      };
    }
    const sameDay = !!i.routeDate && !!i.incomeDate && dayKey(i.routeDate) === dayKey(i.incomeDate);
    if (sameDay) {
      const ev = ['Aparece como entregado por FedEx.'];
      if (i.hasConsolidado) ev.push('Estuvo en un consolidado nuestro.');
      ev.push(`Salió en nuestra ruta el ${dayKey(i.routeDate)}.`);
      ev.push(`El ingreso se generó el mismo día (${dayKey(i.incomeDate)}).`);
      ev.push('Conclusión: lo entregamos nosotros; el cobro es válido.');
      return {
        code: 'delivered_by_us', level: 'ok',
        title: 'Lo entregamos nosotros — cobro válido',
        evidence: ev,
        suggestedAction: { kind: 'fix_status', to: ShipmentStatusType.ENTREGADO },
      };
    }
    return {
      code: 'fedex_delivery_doubtful', level: 'danger',
      title: 'Cobro dudoso — sin ruta ese día',
      evidence: [
        'Aparece como entregado por FedEx.',
        i.routeDate
          ? `Salió en ruta el ${dayKey(i.routeDate)}, pero el ingreso es del ${dayKey(i.incomeDate)}.`
          : 'No salió en ninguna ruta nuestra.',
        'Conclusión: probablemente lo entregó FedEx; el cobro no debería existir.',
      ],
      suggestedAction: { kind: 'delete_income' },
    };
  }

  // Cobro sin respaldo terminal.
  if (hasIncome && terminalEvents.length === 0) {
    return {
      code: 'income_without_support', level: 'danger',
      title: 'Cobro sin entrega que lo respalde',
      evidence: ['Hay ingreso pero el paquete no tiene ninguna entrega ni rechazo.'],
      suggestedAction: { kind: 'delete_income' },
    };
  }

  // Fecha del cobro desalineada con los eventos.
  if (hasIncome) {
    const eventDays = new Set((i.history || []).map((h) => dayKey(h.timestamp)).filter(Boolean));
    if (eventDays.size > 0 && !eventDays.has(dayKey(i.incomeDate))) {
      return {
        code: 'date_mismatch', level: 'warn',
        title: 'Fecha del cobro no coincide',
        evidence: ['El ingreso está fechado en un día en que el paquete no se movió.'],
        suggestedAction: { kind: 'none' },
      };
    }
  }

  // Retroceso de estatus.
  if (!currentTerminal && terminalEvents.length > 0) {
    return {
      code: 'status_regressed', level: 'warn',
      title: 'Volvió a tránsito tras un estatus final',
      evidence: ['Tuvo un estatus final pero volvió a aparecer en tránsito.'],
      suggestedAction: { kind: 'none' },
    };
  }

  if (hasIncome) {
    return { code: 'our_delivery_ok', level: 'ok', title: 'Entrega respaldada', evidence: [], suggestedAction: { kind: 'none' } };
  }
  return { code: 'no_income_ok', level: 'ok', title: 'Sin cobro', evidence: [], suggestedAction: { kind: 'none' } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/consolidador/logic/package-verdict.util.spec.ts`
Expected: PASS (8 tests). Corre `npx tsc --noEmit` y deja el archivo sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/consolidador/logic/package-verdict.util.ts src/consolidador/logic/package-verdict.util.spec.ts
git commit -m "feat(consolidador): motor de veredicto de paquete (ruta+ingreso mismo día = entrega nuestra)"
```

---

### Task 2: Enriquecer `search`/`searchBatch` con ruta, consolidado y veredicto (BE)

**Files:**
- Modify: `src/consolidador/status/consolidador-status.service.ts`
- Test: `src/consolidador/status/consolidador-status.service.spec.ts` (existe; añadir casos)

**Interfaces:**
- Consumes: `computeVerdict`, `Verdict`, `VerdictInput` (Task 1); `PackageDispatch` (`../../entities/package-dispatch.entity`), `Consolidated` (`../../entities/consolidated.entity`).
- Produces: cada item de `search`/`searchBatch` gana `verdict: Verdict`. Se conserva `anomalies` para compatibilidad hasta que el FE migre.

- [ ] **Step 1: Write the failing test** — añade a la spec existente un caso que verifica que `search()` devuelve `verdict.code === 'delivered_by_us'` cuando el shipment tiene `routeId` con `routeDate` = día del ingreso y estatus `ENTREGADO_POR_FEDEX`. Mockea los repos de `PackageDispatch`/`Consolidated` (via `shipmentRepo.manager.getRepository`) igual que los mocks actuales del archivo.

```ts
it('search() marca delivered_by_us cuando la ruta cae el mismo día del ingreso', async () => {
  // arrange: shipment ENTREGADO_POR_FEDEX con routeId + income mismo día (usar los mocks del archivo)
  const res = await service.search('T1');
  expect(res.verdict.code).toBe('delivered_by_us');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/consolidador/status/consolidador-status.service.spec.ts`
Expected: FAIL (`verdict` undefined).

- [ ] **Step 3: Implement** — agrega un helper privado que, dado un shipment y su income, cargue `routeDate` y `hasConsolidado` y calcule el veredicto:

```ts
private async verdictFor(shipment: Shipment | null, income: Income | null, fedexFound: boolean): Promise<Verdict> {
  let routeDate: Date | null = null;
  if ((shipment as any)?.routeId) {
    const pd = await this.shipmentRepo.manager.getRepository(PackageDispatch)
      .findOne({ where: { id: (shipment as any).routeId } });
    routeDate = (pd as any)?.routeDate ?? (pd as any)?.createdAt ?? null;
  }
  return computeVerdict({
    currentStatus: shipment?.status ?? null,
    history: (shipment as any)?.statusHistory ?? [],
    hasConsolidado: !!(shipment as any)?.consolidatedId,
    routeDate,
    incomeDate: income?.date ?? null,
    fedexVerified: fedexFound,
  });
}
```

Llama `verdictFor` en `search` y en `searchBatch` (para el batch, precarga los `PackageDispatch` por `routeId` en un solo `find({ where: { id: In(routeIds) } })` y resuelve `routeDate` desde un `Map`, para no hacer N queries). Añade `verdict` al objeto de resultado en ambos. Importa `computeVerdict`, `Verdict`, `PackageDispatch`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/consolidador/status/consolidador-status.service.spec.ts`
Expected: PASS. `npx tsc --noEmit` limpio en el archivo.

- [ ] **Step 5: Commit**

```bash
git add src/consolidador/status/consolidador-status.service.ts src/consolidador/status/consolidador-status.service.spec.ts
git commit -m "feat(consolidador): search/searchBatch devuelven veredicto con ruta+consolidado"
```

---

### Task 3: Lectura agrupada por ruta/consolidado + endpoints (BE)

**Files:**
- Create: `src/consolidador/read/consolidador-groups.service.ts`
- Create: `src/consolidador/read/consolidador-groups.service.spec.ts`
- Modify: `src/consolidador/consolidador.module.ts` (registrar provider)
- Modify: `src/consolidador/consolidador.controller.ts` (2 endpoints)
- Modify: `src/consolidador/consolidador.types.ts` (tipos de grupo)

**Interfaces:**
- Consumes: `computeVerdict`/`Verdict` (Task 1), `CobrosAuditService` (`../audit/cobros-audit.service`), repos `Income`, entidades `Shipment`/`PackageDispatch`/`Consolidated`.
- Produces:
  ```ts
  // en consolidador.types.ts
  export interface GroupRowVerdict { code: string; level: 'ok'|'warn'|'danger'; title: string; evidence: string[]; suggestedAction: any; }
  export interface ConsolidadorGroupRow {
    tracking: string | null; shipmentId: string | null;
    status: string | null; income: { id: string; cost: number } | null;
    verdict: GroupRowVerdict;
  }
  export interface ConsolidadorGroup {
    id: string; label: string; date: string | null;
    meta: { driver?: string | null; owner?: string | null; shipmentCount: number };
    kpis: { delivered: number; notDelivered: number; incomeAmount: number; incomeCount: number; chargeDiscrepancy: number; anomalyCount: number };
    rows: ConsolidadorGroupRow[];
  }
  export interface ConsolidadorGroupsResult { groups: ConsolidadorGroup[]; }
  ```
  Métodos públicos:
  ```ts
  getByRoute(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult>;
  getByConsolidado(subsidiaryId: string, from: Date, to: Date): Promise<ConsolidadorGroupsResult>;
  ```

- [ ] **Step 1: Write the failing test** — spec con datos en memoria mockeando el `incomeRepo.createQueryBuilder` (patrón del archivo `consolidador-read.service.spec.ts` existente) o, más simple, testear un helper puro extraído `buildGroups(rows, keyFn, discrepancyByTracking)` que agrupa filas ya cargadas y calcula KPIs. Recomendado: extraer `buildGroups` puro y testearlo:

```ts
// verifica: delivered cuenta ENTREGADO/ENTREGADO_EN_BODEGA/ENTREGADO_POR_FEDEX;
// notDelivered el resto; incomeAmount suma; envíos sin key caen en grupo 'Sin ruta'.
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/consolidador/read/consolidador-groups.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement** —
  1. En `consolidador.types.ts` agrega los tipos de arriba.
  2. Crea `consolidador-groups.service.ts`: barre la semana con un query builder sobre `income` (join `shipment`, `shipment.statusHistory`, `charge`, y `leftJoin consolidated`), igual filtro de fecha/sucursal/activo que `getWeek`. Para cada income arma una fila con veredicto (reusa `computeVerdict`; carga `routeDate` de los `PackageDispatch` de la semana en un `Map` por `routeId`). Agrupa por `routeId` (getByRoute) o por `consNumber` (getByConsolidado); los que no tienen key van a un grupo `'Sin ruta'`/`'Sin consolidado'`. Define `DELIVERED = new Set([ENTREGADO, ENTREGADO_EN_BODEGA, ENTREGADO_POR_FEDEX])`. `chargeDiscrepancy` por grupo: llama `CobrosAuditService.audit(subsidiaryId, from, to)` una sola vez, indexa los findings por `trackingNumber`, y suma por grupo. `anomalyCount` = filas con `verdict.level !== 'ok'`.
  3. `consolidador.module.ts`: añade `ConsolidadorGroupsService` a `providers`.
  4. `consolidador.controller.ts`: inyecta el servicio y agrega, **antes** del comodín `:subsidiaryId/:fromDate/:toDate`:
     ```ts
     @Get(':subsidiaryId/:fromDate/:toDate/by-route')
     byRoute(@Param('subsidiaryId') s, @Param('fromDate') f, @Param('toDate') t) {
       return this.groups.getByRoute(s, new Date(`${f}T00:00:00.000`), new Date(`${t}T23:59:59.999`));
     }
     @Get(':subsidiaryId/:fromDate/:toDate/by-consolidado')
     byConsolidado(@Param('subsidiaryId') s, @Param('fromDate') f, @Param('toDate') t) {
       return this.groups.getByConsolidado(s, new Date(`${f}T00:00:00.000`), new Date(`${t}T23:59:59.999`));
     }
     ```

- [ ] **Step 4: Run test to verify it passes** — jest verde + `npx tsc --noEmit` limpio en los archivos tocados.

- [ ] **Step 5: Commit**

```bash
git add src/consolidador/read/consolidador-groups.service.* src/consolidador/consolidador.module.ts src/consolidador/consolidador.controller.ts src/consolidador/consolidador.types.ts
git commit -m "feat(consolidador): lectura agrupada por ruta/consolidado con KPIs y veredicto"
```

- [ ] **Step 6: Actualizar grafo** — `graphify update .`

---

### Task 4: FE — tipos, servicios y hook de grupos + veredicto

**Files:**
- Modify: `app-pmy/lib/types/consolidador.ts` (tipos `Verdict`, `ConsolidadorGroup`, etc.; añadir `verdict` a `SearchBatchItem`)
- Modify: `app-pmy/lib/services/consolidador.ts` (`getGroupsByRoute`, `getGroupsByConsolidado`)
- Create: `app-pmy/hooks/services/consolidador/use-consolidador-groups.ts`

**Interfaces:**
- Produces (types, espejo del BE): `Verdict`, `VerdictLevel`, `SuggestedAction`, `ConsolidadorGroup`, `ConsolidadorGroupRow`.
  ```ts
  export function useConsolidadorGroups(
    mode: 'route' | 'consolidado', subsidiaryId: string, from: string, to: string, active: boolean
  ): { data?: { groups: ConsolidadorGroup[] }; isLoading: boolean; mutate: () => Promise<any> };
  ```

- [ ] **Step 1: Añadir tipos** en `lib/types/consolidador.ts` (copiar las interfaces del BE Task 3 + `Verdict` de Task 1). Añadir `verdict?: Verdict` a `SearchBatchItem`.
- [ ] **Step 2: Servicios** en `lib/services/consolidador.ts`:
  ```ts
  export const getGroupsByRoute = (sub: string, from: string, to: string) =>
    api.get(`/consolidador/${sub}/${from}/${to}/by-route`).then(r => r.data);
  export const getGroupsByConsolidado = (sub: string, from: string, to: string) =>
    api.get(`/consolidador/${sub}/${from}/${to}/by-consolidado`).then(r => r.data);
  ```
  (usa el mismo cliente `api`/axios que las funciones vecinas del archivo).
- [ ] **Step 3: Hook** `use-consolidador-groups.ts` con SWR, key `['consolidador-groups', mode, sub, from, to]` cuando `active && sub`.
- [ ] **Step 4: Verificar** — `npx tsc --noEmit` (o el check del repo FE) limpio en los archivos tocados.
- [ ] **Step 5: Commit**

```bash
git add lib/types/consolidador.ts lib/services/consolidador.ts hooks/services/consolidador/use-consolidador-groups.ts
git commit -m "feat(consolidador): tipos, servicios y hook de grupos por ruta/consolidado"
```

---

### Task 5: FE — `verdict-badge`, `group-card` y `groups-view`

**Files:**
- Create: `app-pmy/components/consolidador/verdict-badge.tsx`
- Create: `app-pmy/components/consolidador/group-card.tsx`
- Create: `app-pmy/components/consolidador/groups-view.tsx`
- Create: `app-pmy/lib/consolidador/verdict.ts` (helper puro) + `app-pmy/lib/consolidador/verdict.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/consolidador/verdict.ts
  export function verdictTone(level: 'ok'|'warn'|'danger'): { badge: string; icon: string };
  export function actionLabel(a: SuggestedAction): string | null; // null si kind==='none'
  ```
  `GroupCard` props: `{ group: ConsolidadorGroup; onAction: (row, action, reason) => Promise<void> }`.
  `GroupsView` props: `{ groups: ConsolidadorGroup[]; onAction }`.

- [ ] **Step 1: Test del helper** `verdict.test.ts` (Vitest): `actionLabel({kind:'fix_status',to:'entregado'})` → "Corregir estatus a ENTREGADO"; `{kind:'delete_income'}` → "Eliminar cobro"; `{kind:'none'}` → null. Corre y falla.
- [ ] **Step 2: Implementa** `verdict.ts` para pasar el test.
- [ ] **Step 3: `verdict-badge.tsx`** — Badge shadcn con color por `level` (ok=emerald, warn=amber, danger=rose), `Tooltip` con `evidence[]`, y si hay acción, un `Button` que pide motivo (reusa un pequeño `PromptDialog`/`Input` inline con confirmación) y llama `onAction`.
- [ ] **Step 4: `group-card.tsx`** — `Card` shadcn plegable (usa `Collapsible` de `@/components/ui/collapsible`): cabecera con `label`, `date`, `meta`, badge de `anomalyCount`; grid de 4 KPIs; al expandir, tabla (`DataTable` o tabla shadcn simple) de `rows` con columnas Guía/Estatus/Ingreso/`VerdictBadge`.
- [ ] **Step 5: `groups-view.tsx`** — mapea `groups` a `GroupCard`; estado vacío ("Sin rutas esta semana"). Respeta reglas de la casa (solo shadcn+Tailwind).
- [ ] **Step 6: Verificar** — Vitest verde + type-check limpio.
- [ ] **Step 7: Commit**

```bash
git add components/consolidador/verdict-badge.tsx components/consolidador/group-card.tsx components/consolidador/groups-view.tsx lib/consolidador/verdict.ts lib/consolidador/verdict.test.ts
git commit -m "feat(consolidador): tarjetas plegables por grupo con veredicto y acciones"
```

---

### Task 6: FE — sección Buscar paquete (no modal) + alta precargada

**Files:**
- Create: `app-pmy/components/consolidador/search-package-view.tsx` (extrae la lógica de `search-package-dialog.tsx` a una sección)
- Modify: `app-pmy/components/consolidador/add-income-dialog.tsx` (props `defaultTracking?`, `defaultKind?`)
- Modify: `app-pmy/components/consolidador/search-package-dialog.tsx` (queda solo si algo lo usa; si no, borrar)

**Interfaces:**
- `AddIncomeDialog` gana `defaultTracking?: string; defaultKind?: ManualKind;` — al abrir, precarga `trackingNumber`/`kind`.
- `SearchPackageView` props: `{ selectedSubsidiaryId: string; onFixed: () => void; onAddIncome: (tracking: string) => void }`.

- [ ] **Step 1:** En `add-income-dialog.tsx` acepta `defaultTracking`/`defaultKind` y siembra el estado inicial con ellos (y en `reset()` vuelve a esos defaults). Verifica que sigue pasando `isValidManualIncome`.
- [ ] **Step 2:** Crea `search-package-view.tsx` copiando la mecánica del diálogo actual (búsqueda por lote, motivo compartido, `DataTable` de resultados) pero como sección (sin `Dialog`). Reemplaza la columna `alertas` por `VerdictBadge` (Task 5) usando `row.verdict`.
- [ ] **Step 3:** Para filas con `shipment == null`: en la columna Acciones, muestra `Button` "Dar de alta ingreso" → `onAddIncome(row.tracking)` y "Ver en FedEx" → muestra `row.fedex.status/error` (popover o expand). Quita el texto "no existe".
- [ ] **Step 4:** Rediseña visual con shadcn (cards/headers/spacing) siguiendo `frontend-design`.
- [ ] **Step 5: Verificar** — type-check limpio; render manual en preview (Task 7 valida integrado).
- [ ] **Step 6: Commit**

```bash
git add components/consolidador/search-package-view.tsx components/consolidador/add-income-dialog.tsx
git commit -m "feat(consolidador): buscar paquete como seccion, alta precargada y ver en FedEx"
```

---

### Task 7: FE — página con 4 pestañas + rediseño coherente + verificación en preview

**Files:**
- Modify: `app-pmy/app/finanzas/consolidador/page.tsx`

**Interfaces:**
- Consumes: `GroupsView` (Task 5), `SearchPackageView` (Task 6), `useConsolidadorGroups` (Task 4), `CobrosAuditPanel` (existente), `AddIncomeDialog` con nuevas props (Task 6).

- [ ] **Step 1:** Reestructura `Tabs` a 4 valores: `por-ruta` · `por-consolidado` · `buscar` · `auditoria`. `por-ruta`/`por-consolidado` renderizan `GroupsView` con `useConsolidadorGroups(mode, …, active)`. `buscar` renderiza `SearchPackageView`. `auditoria` mantiene `CobrosAuditPanel`.
- [ ] **Step 2:** Estado del `AddIncomeDialog` con `defaultTracking`; `SearchPackageView.onAddIncome(tracking)` setea el default y abre el diálogo. `onAction` de los grupos aplica `fixPackageStatus`/`deleteIncome` según `suggestedAction` (reusa servicios existentes) y hace `mutate()`.
- [ ] **Step 3:** Rediseño coherente (header, spacing, KPIs, tabs) con `frontend-design`; mantén `AppLayout`+`withAuth`+`OperationHeader`.
- [ ] **Step 4: Verificar en preview** — `preview_start {name}`; con una sucursal y una semana con datos: confirma que cargan las 4 pestañas, que una tarjeta se expande con veredictos, que "Dar de alta ingreso" precarga la guía, y revisa `read_console_messages`/`read_network_requests` sin errores. Toma screenshot.
- [ ] **Step 5: Commit**

```bash
git add app/finanzas/consolidador/page.tsx
git commit -m "feat(consolidador): pagina con 4 pestanas (por ruta/consolidado/buscar/auditoria) redisenada"
```

---

## Self-Review

- **Cobertura del spec:** #1 (alta+FedEx en no-existe) → Task 6; #2 (veredicto+fix) → Task 1/2/5/7; #3 (rediseño) → Task 5/6/7; #4 (vista por ruta/consolidado) → Task 3/4/5/7. KPIs → Task 3. Entregado=toda entrega → Task 3. Sin migraciones → todo. ✔
- **Placeholders:** el código de utils/servicios/endpoints está explícito; los pasos de componentes FE describen archivo, props y contenido. Sin "TBD".
- **Consistencia de tipos:** `computeVerdict`/`Verdict`/`VerdictInput` (Task 1) se consumen igual en Task 2/3; `ConsolidadorGroup`/`ConsolidadorGroupRow` (Task 3) se espejan en FE Task 4; `AddIncomeDialog` props nuevas (Task 6) usadas en Task 7.
