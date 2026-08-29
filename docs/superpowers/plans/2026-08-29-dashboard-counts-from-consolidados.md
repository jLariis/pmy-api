# Dashboard conteos desde consolidados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-anclar los conteos de paquetes del Dashboard Ejecutivo a los consolidados, de modo que den exactamente los mismos números que la pantalla de Consolidados.

**Architecture:** Se extrae una función pura de rollup por sucursal (`consolidated-package-rollup.ts`) fácil de testear sin BD. `KpiService.getSubsidiariesKpis` deja de contar sobre `shipment.createdAt`/`charge.chargeDate` y pasa a reutilizar `ConsolidatedService.findAll` (fuente única de verdad) + el rollup; los conteos financieros (Income/Expense) quedan intactos. El contrato `SubsidiaryMetrics` del front no se toca.

**Tech Stack:** NestJS, TypeORM, Jest. Backend `pmy-api` únicamente.

## Global Constraints

- Contrato `SubsidiaryMetrics` (`app-pmy/components/subsidiary/subsidiary-metrics.tsx`) se conserva **idéntico**. Sin cambios en `app-pmy`.
- No tocar los cálculos financieros: `totalRevenue`, `totalExpenses`, `totalProfit`, `generalSummary`.
- No tocar `dashboard.controller.ts` (scoping por rol + blindaje de ingresos).
- `total` = declarado (`SUM(numberOfPackages)`). `averageEfficiency = deliveredPackages / totalPackages`.
- Guías sin `consolidatedId` quedan fuera (comportamiento heredado de `findAll`, que solo agrega por `consolidatedId`).
- `consolidations.total` incluye consolidados tipo `carga`. `undeliveredDetails.byExceptionCode.unknown` = `Σ otros`. `totalCharges` = `Σ countF2`.
- Jest: `testRegex = .*\.spec\.ts$`, `globalSetup` fija `TZ=UTC`. Ejecutar con `npm test`.
- Regla del proyecto: dejar `tsc` y lint limpios en los archivos tocados.

---

### Task 1: Función pura de rollup por sucursal

**Files:**
- Create: `src/dashboard/consolidated-package-rollup.ts`
- Test: `src/dashboard/consolidated-package-rollup.spec.ts`

**Interfaces:**
- Consumes: nada (función pura).
- Produces:
  - `interface ConsolidatedRollupInput { subsidiaryId: string; type: string; numberOfPackages: number | string | null; entregado: number; dex03: number; dex07: number; dex08: number; en_ruta: number; otros: number; countF2: number; }`
  - `interface SubsidiaryPackageStats { totalPackages: number; deliveredPackages: number; undeliveredPackages: number; byExceptionCode: { code07: number; code08: number; code03: number; unknown: number }; inTransitPackages: number; totalCharges: number; consolidations: { ordinary: number; air: number; total: number }; }`
  - `function emptyPackageStats(): SubsidiaryPackageStats`
  - `function rollupConsolidatedPackageStats(rows: ConsolidatedRollupInput[]): Map<string, SubsidiaryPackageStats>`

- [ ] **Step 1: Write the failing test**

```ts
// src/dashboard/consolidated-package-rollup.spec.ts
import {
  rollupConsolidatedPackageStats,
  emptyPackageStats,
  ConsolidatedRollupInput,
} from './consolidated-package-rollup';

const row = (o: Partial<ConsolidatedRollupInput>): ConsolidatedRollupInput => ({
  subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 0,
  entregado: 0, dex03: 0, dex07: 0, dex08: 0, en_ruta: 0, otros: 0, countF2: 0, ...o,
});

describe('rollupConsolidatedPackageStats', () => {
  it('suma numberOfPackages (declarado) y el desglose real por sucursal', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 10, entregado: 4, dex07: 1, en_ruta: 2, countF2: 3 }),
      row({ subsidiaryId: 's1', type: 'aereo', numberOfPackages: 5, entregado: 2, dex03: 1, otros: 1, countF2: 1 }),
    ]);
    const s = map.get('s1')!;
    expect(s.totalPackages).toBe(15);          // declarado
    expect(s.deliveredPackages).toBe(6);
    expect(s.undeliveredPackages).toBe(2);     // dex03+dex07+dex08 = 1+1+0
    expect(s.byExceptionCode).toEqual({ code07: 1, code08: 0, code03: 1, unknown: 1 });
    expect(s.inTransitPackages).toBe(2);
    expect(s.totalCharges).toBe(4);            // countF2 = 3+1
    expect(s.consolidations).toEqual({ ordinary: 1, air: 1, total: 2 });
  });

  it('clasifica carga en el total pero no en ordinary/air', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', type: 'carga', numberOfPackages: 7 }),
      row({ subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 3 }),
    ]);
    const s = map.get('s1')!;
    expect(s.consolidations).toEqual({ ordinary: 1, air: 0, total: 2 });
    expect(s.totalPackages).toBe(10);
  });

  it('coacciona numberOfPackages string/null a numero', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: '8' as any }),
      row({ subsidiaryId: 's1', numberOfPackages: null as any }),
    ]);
    expect(map.get('s1')!.totalPackages).toBe(8);
  });

  it('separa sucursales distintas', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: 4 }),
      row({ subsidiaryId: 's2', numberOfPackages: 9 }),
    ]);
    expect(map.get('s1')!.totalPackages).toBe(4);
    expect(map.get('s2')!.totalPackages).toBe(9);
  });

  it('emptyPackageStats devuelve todo en cero', () => {
    expect(emptyPackageStats()).toEqual({
      totalPackages: 0, deliveredPackages: 0, undeliveredPackages: 0,
      byExceptionCode: { code07: 0, code08: 0, code03: 0, unknown: 0 },
      inTransitPackages: 0, totalCharges: 0,
      consolidations: { ordinary: 0, air: 0, total: 0 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- consolidated-package-rollup`
Expected: FAIL — `Cannot find module './consolidated-package-rollup'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/dashboard/consolidated-package-rollup.ts

/** Fila de entrada: un consolidado con su numberOfPackages declarado y el desglose
 *  real de sus guias ligadas (proviene de ConsolidatedService.findAll). */
export interface ConsolidatedRollupInput {
  subsidiaryId: string;
  type: string; // 'ordinario' | 'aereo' | 'carga'
  numberOfPackages: number | string | null;
  entregado: number;
  dex03: number;
  dex07: number;
  dex08: number;
  en_ruta: number;
  otros: number;
  countF2: number;
}

export interface SubsidiaryPackageStats {
  totalPackages: number;
  deliveredPackages: number;
  undeliveredPackages: number;
  byExceptionCode: { code07: number; code08: number; code03: number; unknown: number };
  inTransitPackages: number;
  totalCharges: number;
  consolidations: { ordinary: number; air: number; total: number };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function emptyPackageStats(): SubsidiaryPackageStats {
  return {
    totalPackages: 0,
    deliveredPackages: 0,
    undeliveredPackages: 0,
    byExceptionCode: { code07: 0, code08: 0, code03: 0, unknown: 0 },
    inTransitPackages: 0,
    totalCharges: 0,
    consolidations: { ordinary: 0, air: 0, total: 0 },
  };
}

/** Agrupa consolidados por subsidiaryId. total = SUM(numberOfPackages) declarado;
 *  desglose = SUM de los conteos reales de las guias ligadas. */
export function rollupConsolidatedPackageStats(
  rows: ConsolidatedRollupInput[],
): Map<string, SubsidiaryPackageStats> {
  const map = new Map<string, SubsidiaryPackageStats>();
  for (const r of rows) {
    if (!r?.subsidiaryId) continue;
    let s = map.get(r.subsidiaryId);
    if (!s) { s = emptyPackageStats(); map.set(r.subsidiaryId, s); }

    s.totalPackages += num(r.numberOfPackages);

    const dex03 = num(r.dex03), dex07 = num(r.dex07), dex08 = num(r.dex08);
    s.deliveredPackages += num(r.entregado);
    s.byExceptionCode.code07 += dex07;
    s.byExceptionCode.code08 += dex08;
    s.byExceptionCode.code03 += dex03;
    s.byExceptionCode.unknown += num(r.otros);
    s.undeliveredPackages += dex03 + dex07 + dex08;
    s.inTransitPackages += num(r.en_ruta);
    s.totalCharges += num(r.countF2);

    const type = String(r.type || '').toLowerCase();
    if (type.includes('aereo')) s.consolidations.air += 1;
    else if (type.includes('ordinar')) s.consolidations.ordinary += 1;
    s.consolidations.total += 1;
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- consolidated-package-rollup`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/consolidated-package-rollup.ts src/dashboard/consolidated-package-rollup.spec.ts
git commit -m "feat(dashboard): rollup puro de conteos por sucursal desde consolidados"
```

---

### Task 2: Flag `summaryOnly` en `ConsolidatedService.findAll`

**Files:**
- Modify: `src/consolidated/consolidated.service.ts` (firma de `findAll` y bloque de pendientes, aprox. L306-L416)

**Interfaces:**
- Consumes: nada.
- Produces: nueva firma
  `findAll(scope, fromDate?, toDate?, options?: { summaryOnly?: boolean }): Promise<ConsolidatedDto[]>`
  Cuando `options.summaryOnly === true`, **omite** las consultas de `pendingShipments` y deja `pendingShipments: []` en cada fila. Los `shipmentCounts` (incluido `numberOfPackages`, `entregado`, `dex03/07/08`, `en_ruta`, `otros`, `countF2`) no cambian.

- [ ] **Step 1: Modificar la firma de `findAll`**

En `src/consolidated/consolidated.service.ts`, cambiar la firma actual:

```ts
  async findAll(
  scope: { subsidiaryId?: string; subsidiaryIds?: string[]; zoneId?: string } = {},
  fromDate?: Date,
  toDate?: Date,
): Promise<ConsolidatedDto[]> {
```

por:

```ts
  async findAll(
  scope: { subsidiaryId?: string; subsidiaryIds?: string[]; zoneId?: string } = {},
  fromDate?: Date,
  toDate?: Date,
  options: { summaryOnly?: boolean } = {},
): Promise<ConsolidatedDto[]> {
```

- [ ] **Step 2: Saltar las consultas de pendientes cuando `summaryOnly`**

Localizar el bloque (aprox. L413-L416):

```ts
  const pendingShipments = await buildPendingQuery('shipment');
  const pendingCharges = await buildPendingQuery('charge_shipment');

  const allPending = [...pendingShipments, ...pendingCharges];
```

y reemplazarlo por:

```ts
  // El dashboard reutiliza este metodo solo para conteos (summaryOnly): las listas
  // de pendientes son consultas extra que no necesita, se omiten.
  const allPending = options.summaryOnly
    ? []
    : [
        ...(await buildPendingQuery('shipment')),
        ...(await buildPendingQuery('charge_shipment')),
      ];
```

(La línea final `pendingShipments: allPending.filter(...)` sigue funcionando: con `summaryOnly` queda `[]`.)

- [ ] **Step 3: Verificar compilación y suite existente**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en `consolidated.service.ts`.

Run: `npm test -- consolidated`
Expected: PASS (las specs de `unloading-session-init` siguen verdes; no hay spec directa de `findAll`).

Nota: la parametrización de `summaryOnly` es un guard aditivo de bajo riesgo; su efecto (mismos conteos, `pendingShipments: []`) se valida por revisión de código y por el uso real en la Task 3, no con un mock de QueryBuilder.

- [ ] **Step 4: Commit**

```bash
git add src/consolidated/consolidated.service.ts
git commit -m "feat(consolidated): opcion summaryOnly en findAll (omite listas de pendientes)"
```

---

### Task 3: Re-anclar `getSubsidiariesKpis` a consolidados

**Files:**
- Modify: `src/dashboard/dashboard.module.ts` (importar `ConsolidatedModule`)
- Modify: `src/dashboard/kpi.service.ts` (inyectar `ConsolidatedService`; reescribir la parte de conteos de `getSubsidiariesKpis`)

**Interfaces:**
- Consumes:
  - `ConsolidatedService.findAll(scope, fromDate, toDate, { summaryOnly: true })` (Task 2)
  - `rollupConsolidatedPackageStats`, `emptyPackageStats`, `ConsolidatedRollupInput` (Task 1)
- Produces: el mismo shape de salida actual de `getSubsidiariesKpis` (contrato `SubsidiaryMetrics` intacto), con los conteos de paquetes provenientes del rollup y los financieros sin cambio.

- [ ] **Step 1: Importar `ConsolidatedModule` en `DashboardModule`**

En `src/dashboard/dashboard.module.ts`, agregar el import del módulo (no crea ciclo: nadie importa `DashboardModule` salvo `AppModule`):

```ts
import { ConsolidatedModule } from "src/consolidated/consolidated.module";
```

y añadirlo al arreglo `imports`:

```ts
  imports: [
    TypeOrmModule.forFeature([Expense, Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary]),
    ChargeRulesModule,
    FedexStatusModule,
    ConsolidatedModule,
  ],
```

- [ ] **Step 2: Inyectar `ConsolidatedService` en `KpiService`**

En `src/dashboard/kpi.service.ts`, agregar imports arriba:

```ts
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import {
  rollupConsolidatedPackageStats,
  emptyPackageStats,
  ConsolidatedRollupInput,
  SubsidiaryPackageStats,
} from './consolidated-package-rollup';
```

y añadir el parámetro al final del `constructor` (después de `expenseRepository`):

```ts
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
    private readonly consolidatedService: ConsolidatedService,
  ) {}
```

- [ ] **Step 3: Reescribir la parte de conteos de `getSubsidiariesKpis`**

En `getSubsidiariesKpis`, el `Promise.all` actual trae 5 agregaciones (A shipment, B charge, C expense, D income, E consolidated). **Se eliminan A, B y E** (los conteos de paquetes ahora salen de consolidados) y se **conservan C y D**. Reemplazar desde `// 3. EJECUTAR AGREGACIONES...` hasta el cierre del `Promise.all` por:

```ts
    // 3. Conteos de paquetes: fuente unica = consolidados (mismo motor que la
    //    pantalla de Consolidados). Fechas construidas igual que el controller de
    //    consolidados (new Date('YYYY-MM-DD') -> medianoche UTC) para dar identico.
    const consFrom = new Date(baseStartDate);
    const consTo = new Date(baseEndDate);
    const consolidatedDtos = await this.consolidatedService.findAll(
      hasSubsidiaryFilter ? { subsidiaryIds } : {},
      consFrom,
      consTo,
      { summaryOnly: true },
    );
    const rollupRows: ConsolidatedRollupInput[] = consolidatedDtos.map((c) => ({
      subsidiaryId: c.subsidiary?.id,
      type: c.type,
      numberOfPackages: c.numberOfPackages,
      entregado: c.shipmentCounts?.entregado ?? 0,
      dex03: c.shipmentCounts?.dex03 ?? 0,
      dex07: c.shipmentCounts?.dex07 ?? 0,
      dex08: c.shipmentCounts?.dex08 ?? 0,
      en_ruta: c.shipmentCounts?.en_ruta ?? 0,
      otros: c.shipmentCounts?.otros ?? 0,
      countF2: c.shipmentCounts?.countF2 ?? 0,
    }));
    const packageStatsBySub = rollupConsolidatedPackageStats(rollupRows);

    // 4. Financieros (SIN CAMBIO): gastos (C) e ingresos (D) en paralelo.
    const [expenseStats, incomeStats] = await Promise.all([
      // -- C. GASTOS (entidades que traslapan el rango; se prorratean en JS por periodo) --
      this.expenseRepository.createQueryBuilder('expense')
        .where(new Brackets(qb => {
          qb.where('expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay', { startDay: baseStartDate, endDay: baseEndDate })
            .orWhere('(expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate });
        }))
        .andWhere(subsidiaryCondition('expense'), { subsidiaryIds })
        .getMany(),

      // -- D. INGRESOS TOTALES --
      this.incomeRepository.createQueryBuilder('income')
        .leftJoin('income.subsidiary', 'sub')
        .leftJoin(ChargeRule, 'crs', CHARGE_RULE_SUB_JOIN)
        .leftJoin(ChargeRule, 'crg', CHARGE_RULE_GLOBAL_JOIN)
        .select('income.subsidiaryId', 'subsidiaryId')
        .addSelect(COUNTABLE_REVENUE_SQL, 'totalRevenue')
        .where('income.date BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
        .andWhere(subsidiaryCondition('income'), { subsidiaryIds })
        .groupBy('income.subsidiaryId')
        .getRawMany(),
    ]);
```

- [ ] **Step 4: Reescribir el `map` de resultados por sucursal**

Reemplazar el bloque `const result = subsidiaries.map((subsidiary) => { ... })` por la versión que consume `packageStatsBySub` y conserva los financieros:

```ts
    // 4. MAPEAR LOS RESULTADOS A LA ESTRUCTURA FINAL
    const result = subsidiaries.map((subsidiary) => {
      const iStats = incomeStats.find(i => i.subsidiaryId === subsidiary.id) || {};
      const pkg: SubsidiaryPackageStats = packageStatsBySub.get(subsidiary.id) || emptyPackageStats();

      const totalPackages = pkg.totalPackages;
      const deliveredPackages = pkg.deliveredPackages;
      const inTransitPackages = pkg.inTransitPackages;
      const totalUndelivered = pkg.undeliveredPackages;
      const totalCharges = pkg.totalCharges;
      const totalRevenue = Number(iStats.totalRevenue || 0);

      const subExpenses = expenseStats.filter(e => e.subsidiaryId === subsidiary.id);
      const totalExpenses = subExpenses.reduce(
        (sum, e) => sum + proratedAmountInRange(
          { amount: e.amount, date: e.date, periodStart: e.periodStart, periodEnd: e.periodEnd },
          baseStartDate,
          baseEndDate,
        ),
        0,
      );

      const averageRevenuePerPackage = totalPackages > 0 ? totalRevenue / totalPackages : 0;
      const averageEfficiency = totalPackages > 0 ? (deliveredPackages * 100) / totalPackages : 0;
      const totalProfit = totalRevenue - totalExpenses;

      return {
        subsidiaryId: subsidiary.id,
        subsidiaryName: subsidiary.name,
        state: subsidiary.state || '',
        latitude: subsidiary.latitude != null ? Number(subsidiary.latitude) : null,
        longitude: subsidiary.longitude != null ? Number(subsidiary.longitude) : null,
        totalPackages,
        deliveredPackages,
        undeliveredPackages: totalUndelivered,
        undeliveredDetails: {
          total: totalUndelivered,
          byExceptionCode: {
            code07: pkg.byExceptionCode.code07,
            code08: pkg.byExceptionCode.code08,
            code03: pkg.byExceptionCode.code03,
            unknown: pkg.byExceptionCode.unknown,
          },
        },
        inTransitPackages,
        totalCharges,
        consolidations: {
          ordinary: pkg.consolidations.ordinary,
          air: pkg.consolidations.air,
          total: pkg.consolidations.total,
        },
        averageRevenuePerPackage,
        totalRevenue,
        totalExpenses,
        averageEfficiency,
        totalProfit,
      };
    });
```

El bloque posterior (5. totales generales + 6. inyección de `generalSummary`) **no cambia**.

- [ ] **Step 5: Eliminar código muerto y variables sin usar**

Tras quitar las agregaciones A/B/E, revisar y borrar lo que quede sin uso en `getSubsidiariesKpis` (p.ej. `finalStatuses`, `daysInDateRange`/su `logger.log`, `msPerDay` si ya no se usan). Confirmar que `ShipmentStatusType`, `ConsolidatedType`, `ShipmentType` sigan importados solo si algo los usa; si no, quitarlos (regla del proyecto: dejar el archivo limpio, sin imports/variables muertas).

- [ ] **Step 6: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. Resolver cualquier `unused`/tipo en `kpi.service.ts`.

- [ ] **Step 7: Verificar arranque del contenedor DI (sin ciclos)**

Run: `npm run build`
Expected: build OK. (Si Nest reportara dependencia circular al resolver `ConsolidatedService`, envolver el import en `forwardRef` — no se espera, porque `ConsolidatedModule` no importa `DashboardModule`.)

- [ ] **Step 8: Correr toda la suite**

Run: `npm test`
Expected: PASS, incluidos `consolidated-package-rollup.spec.ts` y `welcome-scan-code.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/dashboard.module.ts src/dashboard/kpi.service.ts
git commit -m "feat(dashboard): conteos de paquetes desde consolidados (findAll + rollup); financieros sin cambio"
```

---

### Task 4: Verificación de paridad (dashboard == pantalla Consolidados)

**Files:**
- Test: `src/dashboard/consolidated-package-rollup.spec.ts` (añadir un bloque de paridad)

**Interfaces:**
- Consumes: `rollupConsolidatedPackageStats`, `ConsolidatedRollupInput`.
- Produces: nada.

- [ ] **Step 1: Escribir el test de paridad**

Simula la salida de `findAll` (varios consolidados de 2 sucursales) y verifica que el rollup reproduce exactamente lo que la pantalla de Consolidados suma (`Σ shipmentCounts.entregado`, `Σ totalDex`, `Σ en_ruta`, `Σ numberOfPackages`), demostrando que ambos números empatan.

```ts
describe('paridad dashboard vs pantalla Consolidados', () => {
  it('el rollup reproduce la suma directa de findAll para el mismo scope', () => {
    // Salida simulada de ConsolidatedService.findAll (subset de shipmentCounts que usa el rollup)
    const findAllOut = [
      { subsidiary: { id: 's1' }, type: 'ordinario', numberOfPackages: 20, shipmentCounts: { entregado: 12, dex03: 1, dex07: 2, dex08: 0, en_ruta: 3, otros: 1, countF2: 4 } },
      { subsidiary: { id: 's1' }, type: 'aereo',     numberOfPackages: 8,  shipmentCounts: { entregado: 5,  dex03: 0, dex07: 1, dex08: 1, en_ruta: 1, otros: 0, countF2: 0 } },
      { subsidiary: { id: 's2' }, type: 'carga',     numberOfPackages: 30, shipmentCounts: { entregado: 25, dex03: 2, dex07: 0, dex08: 0, en_ruta: 2, otros: 1, countF2: 9 } },
    ];

    // Adaptador identico al de kpi.service (Task 3, Step 3)
    const rows: ConsolidatedRollupInput[] = findAllOut.map((c: any) => ({
      subsidiaryId: c.subsidiary.id, type: c.type, numberOfPackages: c.numberOfPackages,
      entregado: c.shipmentCounts.entregado, dex03: c.shipmentCounts.dex03,
      dex07: c.shipmentCounts.dex07, dex08: c.shipmentCounts.dex08,
      en_ruta: c.shipmentCounts.en_ruta, otros: c.shipmentCounts.otros, countF2: c.shipmentCounts.countF2,
    }));
    const map = rollupConsolidatedPackageStats(rows);

    // Suma directa "a mano" (lo que hace la pantalla de Consolidados)
    const sum = (sub: string, f: (c: any) => number) =>
      findAllOut.filter(c => c.subsidiary.id === sub).reduce((a, c) => a + f(c), 0);

    for (const sub of ['s1', 's2']) {
      const s = map.get(sub)!;
      expect(s.totalPackages).toBe(sum(sub, c => c.numberOfPackages));
      expect(s.deliveredPackages).toBe(sum(sub, c => c.shipmentCounts.entregado));
      expect(s.undeliveredPackages).toBe(sum(sub, c => c.shipmentCounts.dex03 + c.shipmentCounts.dex07 + c.shipmentCounts.dex08));
      expect(s.inTransitPackages).toBe(sum(sub, c => c.shipmentCounts.en_ruta));
    }
  });
});
```

- [ ] **Step 2: Correr el test**

Run: `npm test -- consolidated-package-rollup`
Expected: PASS (6 tests en total).

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/consolidated-package-rollup.spec.ts
git commit -m "test(dashboard): paridad de conteos dashboard vs pantalla Consolidados"
```

---

## Self-Review

**Spec coverage:**
- §2 total=declarado → Task 1 (`totalPackages = Σ numberOfPackages`) + Task 3.
- §2 desglose desde guias ligadas → Task 1 mapeo + Task 3 adaptador desde `findAll`.
- §2 fuente unica `findAll` → Task 3 Step 3.
- §2 guias sin consolidatedId fuera → heredado de `findAll` (solo agrega por `consolidatedId`); documentado en Global Constraints.
- §2 financieros sin cambio → Task 3 Steps 3-4 (C/D intactos, `generalSummary` sin tocar).
- §4 reuso de fechas UTC → Task 3 Step 3 (`new Date(baseStartDate/baseEndDate)`).
- §4 optimización summaryOnly → Task 2.
- §5 mapeo de campos (unknown=otros, carga en total, totalCharges=ΣcountF2, efficiency=entregado/declarado) → Task 1 + Task 3 Step 4.
- §7 pruebas (rollup, sin consolidados, DHL por pieza, efficiency, paridad) → Tasks 1 y 4. (DHL: cubierto porque cada pieza es una fila contada por `findAll`; el rollup suma esas filas.)

**Placeholder scan:** sin TBD/TODO; todos los steps con código real.

**Type consistency:** `ConsolidatedRollupInput`/`SubsidiaryPackageStats`/`rollupConsolidatedPackageStats`/`emptyPackageStats` idénticos entre Task 1, 3 y 4. `findAll(..., { summaryOnly })` idéntico entre Task 2 y 3.
