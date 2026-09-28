# Reglas de cobro FedEx unificadas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Estado: BORRADOR PARA APROBACIÓN.** No se escribe código hasta que el usuario dé el visto bueno al 100%.

**Goal:** Que TODO lo que actualiza estatus desde FedEx o crea/modifica un ingreso FedEx pase por UNA sola decisión de cobro que aplica las reglas generales y las de cada sucursal, y dejar el motor nuevo de estatus listo para encenderse por sucursal.

**Architecture:** Un decisor puro `decideFedexIncome()` (sin BD, 100% probado) + un servicio `FedexIncomeService` que junta los hechos de BD, llama al decisor y escribe. Los 12 caminos FedEx que hoy crean ingresos con su propia lógica se reconectan a ese servicio. Después, una fachada `FedexSyncFacade` decide por sucursal si el estatus lo escribe el legacy o el motor nuevo (tracking-sync), y el interruptor deja de apagar cosas que no debe.

**Tech Stack:** NestJS + TypeORM (MySQL), Jest; app-pmy Next.js + shadcn (solo para la pantalla de paridad).

## Global Constraints

- **Solo FedEx.** DHL NO se toca: ni `persistDhlNativeResults`, ni el cierre DHL (`routeclosure.service.ts:560-625`), ni la fase DHL del cron. La única línea que se toca cerca de DHL es para que el interruptor del motor nuevo **deje de apagar** la fase DHL (hoy la apaga) — el código DHL queda idéntico.
- Rama `feat/reglas-cobro-fedex-unificadas` en pmy-api y app-pmy.
- Esquema SOLO por migración (DB_SYNC=false en todos los entornos).
- Nunca borrar ingresos: corregir = `active=0` + `annulledAt` + auditoría, y solo con aprobación.
- Día/semana de negocio = Hermosillo (UTC-7 fijo), semana lunes–domingo.
- Costo = `subsidiary.fedexCostPackage` (FedEx).
- Fecha del ingreso = hora EXACTA del evento FedEx; si no hay evento, 07:00Z del día operativo (00:00 Hermosillo).
- Textos visibles en español llano (sin tecnicismos).
- Al terminar cada tarea: `npx tsc --noEmit`, pruebas del módulo, `graphify update .`.

---

## Diagnóstico (resumen de lo encontrado el 2026-09-27)

18 caminos escriben estatus o ingresos; 12 de ellos crean ingresos FedEx y cada uno trae su propia versión de las reglas:

| Regla | Hoy |
|---|---|
| `charge_rule` (general + sucursal) al guardar | Ninguno. Solo se aplica al leer (dashboard/KPI); ingresos sin código se cuentan siempre. |
| DEX08 = 3 días distintos misma semana | 6 implementaciones; forense cuenta eventos; cierre acepta cualquier semana. |
| Ruta 31.5 no cobra por guía | Solo el cierre. El cron legacy sí cobra. |
| 005 / entregado por FedEx | Parcial; la subida de Excel cobra cualquier DL. |
| Semana lun–dom | 5 cálculos; dos meten el domingo en la semana siguiente; uno falla en cambio de año. |
| Fecha | Exacta / 00:00 / 12:00 / hora de captura. |
| Devolución anula entregado | Solo devoluciones; reparar del Consolidador vuelve DEVUELTO→DEX. |
| Duplicado | Por semana (motor), de por vida (cierre), mismo día (Consolidador). |

Motor nuevo: en `main`, apagado (`TRACKING_SYNC_CUTOVER=false`, solo `.env`). Paridad de estatus últimos 7 días 80–87% (la mayoría "legacy: en ruta / nuevo: entregado"). Si se enciende hoy: apaga DHL, deja sin rastreo a las sucursales fuera de la lista, y los endpoints manuales siguen usando legacy en paralelo.

---

## Reglas del decisor (lo que el usuario aprueba)

El decisor recibe un **desenlace** de una guía (ENTREGADO o DEX con código, con su hora) y decide `crear`, `subir a entregado` o `no cobrar` (con motivo en llano). En este orden, el primero que aplica gana:

1. **Carga F2 (charge_shipment)** → no cobra por guía (se cobra por carga, flujo aparte, no se toca).
2. **Ruta 31.5** (la guía salió ese día en una ruta 31.5) → no cobra.
3. **Entregado por FedEx** (005 u OD) **y NO salió en nuestra ruta ese día con nuestro consolidado** → no cobra. Si salió en nuestra ruta ese día → es nuestra entrega y cobra como ENTREGADO.
4. **Devolución registrada** de la guía el mismo día o después → el ENTREGADO no cobra (y el existente se anula por el flujo de devoluciones, como hoy).
5. **Regla de cobro** `charge_rule` para (fedex, código): primero la de la sucursal, si no la general. `false` → no cobra. Sin regla → cobra (igual que hoy al leer). Código de ENTREGADO = `DELIVERED`.
6. **DEX08** → solo cobra el evento que completa el **3er día distinto con 08 de SU semana** (Hermosillo, lun–dom). Los demás 08 no cobran.
7. **Sin código** en un DEX → no cobra (hoy se colaban como "cuenta siempre").
8. **Duplicados** (solo ingresos `active=1` de la misma guía):
   - Ya hay ENTREGADO (cualquier semana) → no cobra.
   - Llega ENTREGADO y hay un DEX en la MISMA semana → **sube** ese DEX a ENTREGADO (fecha/hora del entregado).
   - Llega DEX y ya hay cualquier ingreso esa semana → no cobra (un cobro por guía por semana).
9. **Costo 0** en la sucursal → no cobra y se registra error de configuración (hoy unos guardan $0 y otros no).
10. Si pasa todo → **crea** con costo de sucursal, `incomeType` (ENTREGADO / NO_ENTREGADO), `nonDeliveryStatus` = código, `date` = hora exacta del evento, `sourceEventKey` si viene del motor, `createdById` si lo hizo un usuario.

**Filtro al leer:** el dashboard y KPIs siguen aplicando `charge_rule` al leer (red de seguridad). Como ya no se guardan ingresos que la regla no cobra, ambos coinciden.

**Excepción — alta manual del Consolidador:** pasa por el mismo decisor; si dice "no cobra", el superadmin ve el motivo y puede **forzar** con motivo obligatorio (queda en auditoría como `manual_override`).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| Create `src/income-policy/hermosillo-week.util.ts` | Día y semana Hermosillo (lun–dom) únicos: `hermosilloDay`, `hermosilloWeekRange`, `hermosilloWeekKey`. |
| Create `src/income-policy/fedex-income.policy.ts` | Decisor puro `decideFedexIncome(input): FedexIncomeDecision` + tipos y motivos. |
| Create `src/income-policy/fedex-income.policy.spec.ts` | Un caso por regla y combinaciones reales (Cabo 14-09, Hermosillo 22-09). |
| Create `src/income-policy/fedex-income.service.ts` | Junta hechos de BD por lote (rutas, 31.5, devolución, 08s, ingresos de la semana, costo, resolver de reglas) → decisor → escribe (`report` / `persist`). |
| Create `src/income-policy/fedex-income.service.spec.ts` | Carga de hechos + escritura idempotente con repos simulados. |
| Create `src/income-policy/income-policy.module.ts` | Exporta `FedexIncomeService`. |
| Modify `src/common/dex08-week.util.ts` | `isoWeekKey`/`dex08DayKey` pasan a día Hermosillo (hoy usan la zona del servidor). |
| Modify `src/tracking-sync/income/income-executor.ts` | Delega en `FedexIncomeService` (se conserva la interfaz `execute(effects, mode)`). |
| Modify `src/tracking-sync/rules/income.chargeable.ts`, `income-header-safety-net.rule.ts` | Sin su copia del DEX08; el safety net aplica 005/nuestra ruta y exige `actualDeliveryAt`. |
| Modify `src/shipments/shipments.service.ts` | `processMasterFedexUpdate`, subida de Excel, forense `applyFix`: ingresos vía servicio. Borrar código muerto. |
| Modify `src/routeclosure/routeclosure.service.ts` | `reconcileRouteIncome` y No VAN (FedEx) vía servicio. DHL intacto. |
| Modify `src/pick-up/pick-up.service.ts` | Entregado en bodega FedEx vía servicio (DHL intacto). |
| Modify `src/consolidador/status/consolidador-status.service.ts`, `income/consolidador-income.service.ts` | Reparar / corregir estatus / alta manual vía servicio. |
| Create `src/tracking-sync/fedex-sync.facade.ts` | Entrada única de estatus FedEx: por sucursal decide legacy o motor nuevo. |
| Modify `src/tracking/tracking.cron.service.ts`, `src/tracking-sync/cutover.config.ts`, `tracking-sync-persist.cron.ts` | Interruptor por sucursal real; DHL siempre corre. |
| Modify `src/tracking-sync/parity/parity.service.ts` + app-pmy `app/dev/tracking-sync/paridad/page.tsx` | Clasificar diferencias ("legacy atrasado" vs "diferencia real") con muestra. |
| Create `src/income-policy/historical-audit.service.ts` + endpoint | Reporte de ingresos históricos que no cumplen (solo lectura). |

---

## FASE 1 — Decisor único (sin cambiar comportamiento en producción todavía)

### Task 1: Día y semana Hermosillo únicos

**Files:**
- Create: `src/income-policy/hermosillo-week.util.ts`
- Test: `src/income-policy/hermosillo-week.util.spec.ts`
- Modify: `src/common/dex08-week.util.ts:22-31` (usar `hermosilloDay`)

**Interfaces:**
- Produces: `hermosilloDay(d: Date): string` ('YYYY-MM-DD'), `hermosilloWeekRange(d: Date): { start: Date; end: Date }` (UTC: lunes 07:00Z → lunes siguiente 07:00Z, fin exclusivo), `hermosilloWeekKey(d: Date): string` ('YYYY-Www' ISO).

- [ ] **Step 1: Prueba que falla**

```ts
import { hermosilloDay, hermosilloWeekKey, hermosilloWeekRange } from './hermosillo-week.util';

describe('hermosillo-week', () => {
  it('día Hermosillo: 2026-09-28 05:00Z todavía es domingo 27', () => {
    expect(hermosilloDay(new Date('2026-09-28T05:00:00Z'))).toBe('2026-09-27');
  });
  it('domingo 23:00 Hermosillo cae en la semana del lunes anterior (no en la siguiente)', () => {
    const r = hermosilloWeekRange(new Date('2026-09-28T06:00:00Z')); // dom 27 23:00 HMO
    expect(r.start.toISOString()).toBe('2026-09-21T07:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-28T07:00:00.000Z');
  });
  it('clave ISO robusta en cambio de año', () => {
    expect(hermosilloWeekKey(new Date('2027-01-01T18:00:00Z'))).toBe('2026-W53');
  });
});
```

- [ ] **Step 2:** `npx jest src/income-policy/hermosillo-week` → FAIL (no existe).
- [ ] **Step 3: Implementación**

```ts
const OFFSET_MS = 7 * 3600 * 1000; // Hermosillo = UTC-7 fijo, sin horario de verano

export function hermosilloDay(d: Date): string {
  return new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

export function hermosilloWeekRange(d: Date): { start: Date; end: Date } {
  const local = new Date(d.getTime() - OFFSET_MS);
  const dow = local.getUTCDay(); // 0=dom
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (dow === 0 ? 6 : dow - 1)));
  const start = new Date(monday.getTime() + OFFSET_MS);
  return { start, end: new Date(start.getTime() + 7 * 86400000) };
}

export function hermosilloWeekKey(d: Date): string {
  const local = new Date(d.getTime() - OFFSET_MS);
  const t = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow); // jueves de la semana ISO
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
```

- [ ] **Step 4:** en `dex08-week.util.ts` cambiar `isoWeekKey` → `hermosilloWeekKey(d)` y `dex08DayKey` → `hermosilloDay(d)`. Correr `npx jest src/common src/tracking-sync src/routeclosure` → PASS (si alguna prueba asumía la zona del servidor, ajustarla al día Hermosillo y anotarlo en el commit).
- [ ] **Step 5: Commit** `feat(cobros): dia y semana Hermosillo unicos para reglas de cobro`

### Task 2: Decisor puro `decideFedexIncome`

**Files:**
- Create: `src/income-policy/fedex-income.policy.ts`
- Test: `src/income-policy/fedex-income.policy.spec.ts`

**Interfaces:**
- Consumes: `hermosilloWeekRange`, `hermosilloDay` (Task 1); `weeklyDex08ChargeIndexes` (`src/common/dex08-week.util.ts`); `DELIVERED_CODE` (`src/common/income-rules.util.ts`).
- Produces:

```ts
export type IncomeOrigin = 'cron_legacy' | 'motor' | 'cierre_ruta' | 'no_van' | 'bodega' | 'forense' | 'excel' | 'consolidador_reparar' | 'consolidador_manual' | 'consolidador_estatus';

export interface FedexOutcome {
  kind: 'DELIVERED' | 'DEX';
  code: string | null;       // DEX: '03','07','08',...; DELIVERED: null
  at: Date;                  // hora exacta del evento FedEx (o 07:00Z del día operativo si no hay evento)
  eventKey?: string | null;  // motor: sourceEventKey
  deliveredByFedex?: boolean; // 005 u OD en el historial
}

export interface FedexIncomeFacts {
  trackingNumber: string;
  subsidiaryId: string;
  shipmentId: string | null;
  kind: 'shipment' | 'charge';
  routeDays: { day: string; is315: boolean }[]; // días Hermosillo de sus salidas a ruta
  hasConsolidado: boolean;
  returnedOnOrAfter: string | null;             // día de devolución más temprana ≥ día del desenlace
  dex08Dates: Date[];                           // todos los 08 conocidos (BD + FedEx)
  activeIncomes: { id: string; incomeType: string; nonDeliveryStatus: string | null; date: Date }[]; // misma guía, active=1
  cost: number;                                 // subsidiary.fedexCostPackage
  isChargeable: (code: string) => boolean | undefined; // resolver.isChargeable('fedex', code)
}

export type SkipReason =
  | 'CARGA_F2' | 'RUTA_315' | 'ENTREGADO_POR_FEDEX' | 'DEVOLUCION' | 'REGLA_NO_COBRA'
  | 'DEX08_NO_ES_3ER_DIA' | 'SIN_CODIGO' | 'YA_ENTREGADO' | 'YA_COBRADO_SEMANA' | 'COSTO_CERO';

export const SKIP_LABEL: Record<SkipReason, string>; // texto en llano para pantallas/logs

export type FedexIncomeDecision =
  | { action: 'skip'; reason: SkipReason }
  | { action: 'create'; incomeType: 'entregado' | 'no_entregado'; nonDeliveryStatus: string | null; date: Date; cost: number; sourceEventKey: string | null }
  | { action: 'upgrade'; incomeId: string; date: Date; sourceEventKey: string | null };

export function decideFedexIncome(outcome: FedexOutcome, facts: FedexIncomeFacts): FedexIncomeDecision;
```

- [ ] **Step 1: Pruebas que fallan** (una por regla + casos reales)

```ts
import { decideFedexIncome, FedexIncomeFacts, FedexOutcome } from './fedex-income.policy';

const base = (p: Partial<FedexIncomeFacts> = {}): FedexIncomeFacts => ({
  trackingNumber: 'TN', subsidiaryId: 'S', shipmentId: 'SH', kind: 'shipment',
  routeDays: [{ day: '2026-09-22', is315: false }], hasConsolidado: true, returnedOnOrAfter: null,
  dex08Dates: [], activeIncomes: [], cost: 52, isChargeable: () => undefined, ...p,
});
const pod = (at = '2026-09-22T20:10:00Z', o: Partial<FedexOutcome> = {}): FedexOutcome => ({ kind: 'DELIVERED', code: null, at: new Date(at), ...o });
const dex = (code: string, at = '2026-09-22T20:10:00Z'): FedexOutcome => ({ kind: 'DEX', code, at: new Date(at) });

describe('decideFedexIncome', () => {
  it('crea ENTREGADO con hora exacta y costo de sucursal', () => {
    expect(decideFedexIncome(pod(), base())).toEqual({ action: 'create', incomeType: 'entregado', nonDeliveryStatus: null, date: new Date('2026-09-22T20:10:00Z'), cost: 52, sourceEventKey: null });
  });
  it('carga F2 no cobra por guía', () => {
    expect(decideFedexIncome(pod(), base({ kind: 'charge' }))).toEqual({ action: 'skip', reason: 'CARGA_F2' });
  });
  it('ruta 31.5 ese día no cobra', () => {
    expect(decideFedexIncome(pod(), base({ routeDays: [{ day: '2026-09-22', is315: true }] }))).toEqual({ action: 'skip', reason: 'RUTA_315' });
  });
  it('005 sin nuestra ruta ese día no cobra; con nuestra ruta y consolidado sí', () => {
    expect(decideFedexIncome(pod(undefined, { deliveredByFedex: true }), base({ routeDays: [] }))).toEqual({ action: 'skip', reason: 'ENTREGADO_POR_FEDEX' });
    expect(decideFedexIncome(pod(undefined, { deliveredByFedex: true }), base()).action).toBe('create');
  });
  it('devolución el mismo día o después anula el entregado', () => {
    expect(decideFedexIncome(pod(), base({ returnedOnOrAfter: '2026-09-23' }))).toEqual({ action: 'skip', reason: 'DEVOLUCION' });
  });
  it('charge_rule de la sucursal/general manda (DEX03 apagado)', () => {
    expect(decideFedexIncome(dex('03'), base({ isChargeable: (c) => (c === '03' ? false : undefined) }))).toEqual({ action: 'skip', reason: 'REGLA_NO_COBRA' });
    expect(decideFedexIncome(pod(), base({ isChargeable: (c) => (c === 'DELIVERED' ? false : undefined) }))).toEqual({ action: 'skip', reason: 'REGLA_NO_COBRA' });
  });
  it('DEX08 solo el 3er día distinto de SU semana (caso Hermosillo 22-09: 1 y 2 visitas no cobran)', () => {
    const d = (s: string) => new Date(s);
    expect(decideFedexIncome(dex('08', '2026-09-22T18:00:00Z'), base({ dex08Dates: [d('2026-09-22T18:00:00Z')] }))).toEqual({ action: 'skip', reason: 'DEX08_NO_ES_3ER_DIA' });
    const three = [d('2026-09-21T18:00:00Z'), d('2026-09-22T18:00:00Z'), d('2026-09-23T18:00:00Z')];
    expect(decideFedexIncome(dex('08', '2026-09-23T18:00:00Z'), base({ dex08Dates: three })).action).toBe('create');
    // 3 días pero en semanas distintas → no cobra
    const split = [d('2026-09-19T18:00:00Z'), d('2026-09-20T18:00:00Z'), d('2026-09-21T18:00:00Z')];
    expect(decideFedexIncome(dex('08', '2026-09-21T18:00:00Z'), base({ dex08Dates: split }))).toEqual({ action: 'skip', reason: 'DEX08_NO_ES_3ER_DIA' });
  });
  it('DEX sin código no cobra', () => {
    expect(decideFedexIncome(dex(''), base())).toEqual({ action: 'skip', reason: 'SIN_CODIGO' });
  });
  it('ya entregado (cualquier semana) no vuelve a cobrar (caso Cabo 14-09 cobro doble POD)', () => {
    const inc = [{ id: 'I1', incomeType: 'entregado', nonDeliveryStatus: null, date: new Date('2026-09-14T20:00:00Z') }];
    expect(decideFedexIncome(pod('2026-09-15T20:00:00Z'), base({ activeIncomes: inc, routeDays: [{ day: '2026-09-15', is315: false }] }))).toEqual({ action: 'skip', reason: 'YA_ENTREGADO' });
  });
  it('entregado sube el DEX de la misma semana; DEX sobre cobro de la semana no duplica', () => {
    const inc = [{ id: 'I2', incomeType: 'no_entregado', nonDeliveryStatus: '07', date: new Date('2026-09-21T18:00:00Z') }];
    expect(decideFedexIncome(pod(), base({ activeIncomes: inc }))).toEqual({ action: 'upgrade', incomeId: 'I2', date: new Date('2026-09-22T20:10:00Z'), sourceEventKey: null });
    expect(decideFedexIncome(dex('03'), base({ activeIncomes: inc }))).toEqual({ action: 'skip', reason: 'YA_COBRADO_SEMANA' });
  });
  it('DEX de otra semana no bloquea un DEX nuevo', () => {
    const inc = [{ id: 'I3', incomeType: 'no_entregado', nonDeliveryStatus: '07', date: new Date('2026-09-14T18:00:00Z') }];
    expect(decideFedexIncome(dex('07'), base({ activeIncomes: inc })).action).toBe('create');
  });
  it('costo 0 no cobra', () => {
    expect(decideFedexIncome(pod(), base({ cost: 0 }))).toEqual({ action: 'skip', reason: 'COSTO_CERO' });
  });
});
```

- [ ] **Step 2:** `npx jest src/income-policy/fedex-income.policy` → FAIL.
- [ ] **Step 3: Implementación** (orden = orden de las reglas aprobadas)

```ts
export function decideFedexIncome(o: FedexOutcome, f: FedexIncomeFacts): FedexIncomeDecision {
  const day = hermosilloDay(o.at);
  const skip = (reason: SkipReason): FedexIncomeDecision => ({ action: 'skip', reason });
  const routeToday = f.routeDays.filter((r) => r.day === day);

  if (f.kind === 'charge') return skip('CARGA_F2');
  if (routeToday.some((r) => r.is315)) return skip('RUTA_315');
  if (o.kind === 'DELIVERED' && o.deliveredByFedex && !(routeToday.length && f.hasConsolidado)) return skip('ENTREGADO_POR_FEDEX');
  if (o.kind === 'DELIVERED' && f.returnedOnOrAfter && f.returnedOnOrAfter >= day) return skip('DEVOLUCION');

  const code = o.kind === 'DELIVERED' ? DELIVERED_CODE : String(o.code ?? '').trim();
  if (!code) return skip('SIN_CODIGO');
  if (f.isChargeable(code) === false) return skip('REGLA_NO_COBRA');

  if (code === '08') {
    const others = f.dex08Dates.filter((d) => d.getTime() !== o.at.getTime());
    if (!weeklyDex08ChargeIndexes(others.filter((d) => d < o.at), [o.at]).length) return skip('DEX08_NO_ES_3ER_DIA');
  }

  if (f.activeIncomes.some((i) => i.incomeType === 'entregado')) return skip('YA_ENTREGADO');
  const { start, end } = hermosilloWeekRange(o.at);
  const sameWeek = f.activeIncomes.filter((i) => i.date >= start && i.date < end);
  if (sameWeek.length) {
    return o.kind === 'DELIVERED'
      ? { action: 'upgrade', incomeId: sameWeek[0].id, date: o.at, sourceEventKey: o.eventKey ?? null }
      : skip('YA_COBRADO_SEMANA');
  }

  if (!(f.cost > 0)) return skip('COSTO_CERO');
  return {
    action: 'create',
    incomeType: o.kind === 'DELIVERED' ? 'entregado' : 'no_entregado',
    nonDeliveryStatus: o.kind === 'DELIVERED' ? null : code,
    date: o.at, cost: f.cost, sourceEventKey: o.eventKey ?? null,
  };
}
```

(`SKIP_LABEL`: CARGA_F2 "Es carga F2: se cobra por carga", RUTA_315 "La ruta es 31.5", ENTREGADO_POR_FEDEX "La entregó FedEx, no nuestra ruta", DEVOLUCION "Tiene devolución", REGLA_NO_COBRA "La regla de cobro de la sucursal no cobra este estatus", DEX08_NO_ES_3ER_DIA "DEX08 sin 3 visitas en la semana", SIN_CODIGO "El DEX no trae código", YA_ENTREGADO "Ya está cobrada como entregada", YA_COBRADO_SEMANA "Ya se cobró esta semana", COSTO_CERO "La sucursal tiene costo FedEx en $0".)

- [ ] **Step 4:** `npx jest src/income-policy` → PASS.
- [ ] **Step 5: Commit** `feat(cobros): decisor unico de cobro FedEx con reglas generales y por sucursal`

### Task 3: `FedexIncomeService` (hechos de BD + escritura)

**Files:**
- Create: `src/income-policy/fedex-income.service.ts`, `income-policy.module.ts`, `fedex-income.service.spec.ts`

**Interfaces:**
- Consumes: `decideFedexIncome` (Task 2); `ChargeRulesService.buildResolver(subsidiaryId)` (`src/charge-rules/charge-rules.service.ts:82`).
- Produces:

```ts
export interface FedexIncomeRequest {
  trackingNumber: string;
  shipmentId: string | null;   // null solo en No VAN
  subsidiaryId: string;
  outcome: FedexOutcome;
  origin: IncomeOrigin;
  userId?: string | null;
}
export interface FedexIncomeResult { request: FedexIncomeRequest; decision: FedexIncomeDecision; incomeId?: string }

@Injectable() export class FedexIncomeService {
  /** mode 'report' no escribe (shadow, pantallas); 'persist' escribe. `manager` opcional para usar la transacción del llamador (cierre de ruta). */
  apply(requests: FedexIncomeRequest[], mode: 'report' | 'persist', manager?: EntityManager): Promise<FedexIncomeResult[]>;
}
```

- Carga por lote (una consulta por tipo, no por guía): salidas a ruta (`package_dispatch_history` → `routeDate`, `is315`), consolidado, devoluciones, 08 de `shipment_status` + los de FedEx que vengan en `outcome`, ingresos `active=1` por `trackingNumber`, `fedexCostPackage` por sucursal, y un resolver de reglas por sucursal (cache por llamada).
- Escritura `persist`: dentro de transacción; re-lee ingresos activos de la guía con `SELECT ... FOR UPDATE` antes de crear (evita doble cobro entre cron y cierre corriendo a la vez). `create` → `Income` (`shipmentType=FEDEX`, `sourceType=SHIPMENT`, `isGrouped=false`, `createdById=userId`); `upgrade` → `incomeType=entregado, nonDeliveryStatus=null, date, sourceEventKey`. `COSTO_CERO` → `logger.error('FINANCE_ERROR ...')`.
- Log por corrida: `🧾 [cobros:<origin>] crea N · sube M · no cobra K (motivos: ...)`.

- [ ] **Step 1:** pruebas con `DataSource` simulado (patrón de `routeclosure.closure-fixes.spec.ts`): (a) crea con los hechos cargados; (b) `report` no escribe; (c) segundo `apply` igual no duplica; (d) usa `manager` recibido; (e) resolver por sucursal se construye una vez por sucursal.
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(cobros): servicio unico de cobro FedEx (hechos por lote + escritura idempotente)`

---

## FASE 2 — Reconectar todos los caminos FedEx al servicio

Cada tarea: reemplazar la lógica local por `fedexIncome.apply([...], 'persist')`, borrar la copia de la regla que queda muerta, y ajustar/añadir la prueba del camino. **Ninguna toca DHL.**

### Task 4: Motor nuevo (tracking-sync)
- Modify `src/tracking-sync/income/income-executor.ts`: `execute(effects, mode)` arma `FedexIncomeRequest` desde `payload` (`occurredAt`→`at`, `exceptionCode`→`code`, `eventKey`, `deliveredByFedex` desde el evento 005/OD) y delega. Conserva `ProposedIncome[]` para el shadow (`exists` = decision skip por duplicado).
- Modify `rules/income.chargeable.ts`: quitar su DEX08 propio (lo decide el servicio); solo propone desenlaces.
- Modify `rules/income-header-safety-net.rule.ts`: exige `actualDeliveryAt` (sin caer a `new Date()`), marca `deliveredByFedex` si hay OD/005.
- Test: `income-executor.spec.ts`, `income.rule.spec.ts` actualizados. Commit.

### Task 5: Cron legacy `processMasterFedexUpdate`
- Modify `src/shipments/shipments.service.ts:8657-8781`: donde hoy decide cobro (08 semanal, `generateIncomes`, header safety net) → juntar desenlaces del lote y `apply(..., 'persist')` con `origin:'cron_legacy'`. El estatus NO cambia.
- Borrar la copia DEX08 local y el rango de semana `day(1)/day(7)`.
- Test nuevo `processMasterFedexUpdate.income.spec.ts`: ruta 31.5 ya no cobra; DEX03 con regla apagada no se guarda; domingo cae en su semana. Commit.

### Task 6: Cierre de ruta (FedEx)
- Modify `src/routeclosure/routeclosure.service.ts:164-240` `reconcileRouteIncome` → servicio (`origin:'cierre_ruta'`, `at = eventAt` o 07:00Z del routeDate). Se elimina `reconcileShipmentIncomeAction` si queda sin uso.
- Modify No VAN (`:360-410`) → servicio con `shipmentId:null`, `at` = hora del último scan FedEx (hoy usa 07:00Z), `origin:'no_van'`, usando `manager` del `queryRunner`.
- **No tocar** el bloque DHL `:560-625` ni recolecciones.
- Test: `routeclosure.closure-fixes.spec.ts` + `novan-income.util.spec.ts` ajustados. Commit.

### Task 7: Entregado en bodega (FedEx) + forense + subida de Excel
- `src/pick-up/pick-up.service.ts:110-197`: rama FedEx → servicio (`origin:'bodega'`, `at` = hora de captura, DEX de la semana se sube). Rama DHL intacta.
- `shipments.service.ts:9620` forense `applyFix` → servicio (`origin:'forense'`); borrar su `week08` por eventos.
- `shipments.service.ts:2661/2861/3042` subida de Excel → servicio (`origin:'excel'`); con esto la barrera de pre-registro/005 la aplica el decisor.
- Tests por camino. Commit.

### Task 8: Consolidador (reparar, corregir estatus, alta manual)
- `consolidador-status.service.ts:324` `repairIncome` → servicio (`origin:'consolidador_reparar'`); si `skip`, responde el `SKIP_LABEL` (lo muestra el front tal cual). DEVUELTO ya no se vuelve DEX.
- `:255` `fixStatus` → recalcula con el servicio (anula el ingreso viejo y crea el correcto; nunca deja `nonDeliveryStatus` viejo).
- `consolidador-income.service.ts:82` `createManual` (pod/dex) → exige código para `dex`, pasa por el servicio; si `skip` y el superadmin marca "forzar", crea con auditoría `manual_override`. `editDate` conserva la hora original y solo cambia el día (ya no 12:00).
- app-pmy: diálogo de alta manual con selector de código DEX y casilla "Forzar aunque la regla no cobre" (solo superadmin, motivo obligatorio).
- Tests. Commit.

### Task 9: Borrar código muerto y copias de reglas
- Borrar: `checkStatusOnFedex*` (`shipments.service.ts:1656`, `2085`), `applyIncomeValidationRules` si queda sin uso, `...RulesTesting` + `persistShipmentChanges` y su endpoint `test-check-status`, `getDefaultSubsidiaryRules`, `src/shipments/auxiliary-methods.ts`, `forceFedexStatus` sin uso, `tracking-sync/income/week.util.ts` (reemplazado por Task 1).
- Arreglar `consolidated.service.ts:1017/1116` (pasa strings como `Shipment[]`).
- `npx tsc --noEmit` + suite completa. Commit.

---

## FASE 3 — Estatus: interruptor por sucursal y paridad

### Task 10: Fachada única de estatus FedEx
- Create `src/tracking-sync/fedex-sync.facade.ts`: `syncShipments(shipmentIds, actor)` / `syncCharges(...)` → agrupa por sucursal: en cutover → `TrackingCompareService.applyMany`; si no → legacy `processMasterFedexUpdate`/`processChargeFedexUpdate`.
- Todos los endpoints que hoy llaman legacy directo pasan por la fachada: `package-dispatch.service.ts:1552`, `pendings/update-one` (`:8306`), `backfill-44` (`:4206`), `consolidated.service`, monitoreo, `dev/run-tracking`.
- Test: por sucursal se enruta al motor correcto. Commit.

### Task 11: Interruptor correcto
- `tracking.cron.service.ts:46`: en vez de saltar TODO con cutover, el cron legacy procesa solo sucursales **fuera** de cutover; la fase DHL corre siempre (sin cambiar su código).
- `tracking-sync-persist.cron.ts`: procesa solo sucursales en cutover.
- `cutover.config.ts`: la lista de sucursales pasa a BD (columna `subsidiary.fedexEngineV2` por migración, default 0) con la bandera global del `.env` como interruptor maestro. Pantalla superadmin en app-pmy (Configuración → sucursal: "Motor FedEx nuevo") dentro de AppLayout + OperationHeader, solo shadcn.
- Test: con 1 sucursal en cutover, las demás siguen en legacy y DHL corre. Commit.

### Task 12: Paridad con diagnóstico
- `parity.service.ts`: por diferencia, clasificar **"legacy atrasado"** (el evento FedEx que respalda al nuevo es posterior a la última escritura del legacy) vs **"diferencia real"**; agrupar por sucursal y tipo (en_ruta→entregado, etc.) con muestra de 20 guías y enlace a comparar.
- app-pmy `app/dev/tracking-sync/paridad/page.tsx`: tabla por sucursal con % real (sin contar "atrasado") y botón de muestra.
- Criterio para encender una sucursal: ≥98% sin contar "legacy atrasado" durante 5 días hábiles y cero "diferencia real" en entregado/DEX.
- Commit.

### Task 13: Encendido por sucursal (operación, sin código)
- Con aprobación del usuario por cada sucursal: prender `fedexEngineV2`, observar 2 días (paridad + auditoría de cobros del Consolidador), seguir con la siguiente. Reversible apagando la columna.

---

## FASE 4 — Históricos (solo reporte)

### Task 14: Reporte de ingresos que no cumplen las reglas
- Create `src/income-policy/historical-audit.service.ts` + `GET consolidador/:subsidiaryId/income-policy-audit?from&to` (superadmin, solo lectura): para cada ingreso FedEx activo del rango, re-evalúa con `decideFedexIncome` y lista los que el decisor **no** crearía (motivo) y los desenlaces cobrables **sin** ingreso; además los de fecha 00:00/12:00 con evento FedEx exacto disponible.
- app-pmy: sección en el Consolidador con exportar Excel. **Nada se corrige**: la corrección será otro plan, con aprobación.
- Commit.

---

## Orden de despliegue y reversa

1. Fase 1 (sin efecto en producción: nada lo llama todavía).
2. Fase 2 por tareas; cada una se puede revertir sola (commit por camino).
3. Migración de `fedexEngineV2` (default 0 = todo sigue en legacy).
4. Fase 3 encendido gradual.
5. Fase 4 reporte.

## Riesgos

- **Cambio de cifras**: al aplicar `charge_rule` al guardar y quitar el cobro en rutas 31.5, las cifras nuevas pueden bajar respecto a hoy donde el legacy cobraba de más. Lo mide el reporte de la Fase 4 antes/después.
- **Zona horaria**: Task 1 cambia `isoWeekKey` a Hermosillo; si el servidor de producción ya está en Hermosillo no cambia nada; si está en UTC corrige los 08 de 17:00–23:59.
- **Carreras**: cron y cierre al mismo tiempo → `FOR UPDATE` en Task 3.
