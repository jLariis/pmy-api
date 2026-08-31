# Motor unificado FedEx — Plan F1+F2 (paridad + cobros en shadow)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o subagent-driven-development) para implementar task-por-task. Los pasos usan checkbox (`- [ ]`).

**Goal:** Activar en el motor `tracking-sync` (que ya corre en SHADOW) la derivación de **cobros** anclada al evento terminal de FedEx, con un **reconciliador** que compara los cobros que el motor generaría contra los reales — todo en shadow, sin escribir cobros reales — más observabilidad de paridad. Cimiento del cutover posterior.

**Architecture:** Se implementa la `IncomeRule` (hoy no-op) para encolar un `DeferredEffect{type:'income'}` por cada evento cobrable nuevo (DL / 07·RECHAZADO / 3×08), anclado al `eventKey` del evento. Un `IncomeExecutor` materializa esos efectos de forma idempotente por `Income.sourceEventKey` (columna nueva). En shadow NO escribe: un `IncomeReconciler` computa los cobros propuestos y los compara con los `Income` reales, guardando un reporte. Nada del legacy (`processMasterFedexUpdate`/`generateIncomes`) se toca.

**Tech Stack:** NestJS 10, TypeORM 0.3 + mysql2 (`synchronize:false`), Jest 29. Motor en `src/tracking-sync/`.

## Global Constraints

- **No tocar** `processMasterFedexUpdate`, `processChargeFedexUpdate`, `generateIncomes` ni el cron legacy (`tracking.cron.service.ts`). Siguen siendo la fuente real de cobros hasta el cutover (fase posterior).
- **Nada de escritura de cobros reales en F1/F2.** El `IncomeExecutor` corre solo en modo `report` (shadow) detrás de bandera; el modo `persist` queda implementado pero **apagado**.
- Esquema por **migración** (`synchronize:false`).
- Idempotencia de cobro **anclada al evento** (`Income.sourceEventKey`), no por semana.
- Reglas cobrables idénticas al legacy (`shipments.service.ts:8628-8640`): DL→ENTREGADO; `07`/RECHAZADO→NO_ENTREGADO; `08` acumulado ≥3→NO_ENTREGADO. Solo `kind==='shipment'` (las cargas F2 no cobran por paquete).
- El motor ya lee config de sucursal por entidad (fix #2 ya presente en `rules/external-delivery.rule.ts`).

**Spec:** `docs/superpowers/specs/2026-08-29-fedex-unified-engine-design.md`

---

## File Structure

- Modify `src/entities/income.entity.ts` — columna `sourceEventKey`.
- Create `src/database/migrations/1786000000062-AddIncomeSourceEventKey.ts`.
- Create `src/tracking-sync/rules/income.chargeable.ts` — función pura `deriveChargeableIncomes(...)` (testeable sin DB).
- Create `src/tracking-sync/rules/income.chargeable.spec.ts`.
- Modify `src/tracking-sync/rules/income.rule.ts` — implementar `apply()` (encola efectos).
- Create `src/tracking-sync/income/income-executor.ts` — `IncomeExecutor` (report | persist).
- Create `src/tracking-sync/income/income-executor.spec.ts`.
- Create `src/tracking-sync/income/income-reconciler.ts` — compara propuestos vs reales, arma reporte.
- Create `src/tracking-sync/income/income-reconciler.spec.ts`.
- Modify `src/tracking-sync/tracking-sync.module.ts` — registrar `IncomeExecutor`, `IncomeReconciler`.
- Modify `src/tracking-sync/tracking-sync.orchestrator.ts` — en `runShadow`, invocar el reconciler y contabilizar divergencias (observabilidad).

---

## Task 1: Ancla de cobro en Income (columna + migración)

**Files:**
- Modify: `src/entities/income.entity.ts`
- Create: `src/database/migrations/1786000000062-AddIncomeSourceEventKey.ts`

**Interfaces:**
- Produces: `Income.sourceEventKey: string | null` + índice `IDX_income_source_event` sobre `(trackingNumber, incomeType, sourceEventKey)`.

- [ ] **Step 1: Add the column to the entity**

En `src/entities/income.entity.ts`, agregar (junto a las demás columnas):

```ts
  // Ancla del cobro al evento terminal de FedEx que lo originó (idempotencia fuerte,
  // reconciliación exacta evento↔ingreso). Null en ingresos legacy/agrupados.
  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceEventKey?: string | null;
```

- [ ] **Step 2: Write the migration** (estilo MySQL, guard defensivo — ver `1786000000061`)

`src/database/migrations/1786000000062-AddIncomeSourceEventKey.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Ancla de cobro al evento terminal FedEx: income.sourceEventKey. */
export class AddIncomeSourceEventKey1786000000062 implements MigrationInterface {
  name = 'AddIncomeSourceEventKey1786000000062';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'income', 'sourceEventKey'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`sourceEventKey\` varchar(120) NULL`);
    }
    // Índice de idempotencia/reconciliación (no único: ingresos legacy tienen NULL).
    const idx = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'IDX_income_source_event'`,
    );
    if (Number(idx[0].c) === 0) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_income_source_event\` ON \`income\` (\`trackingNumber\`, \`incomeType\`, \`sourceEventKey\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const idx = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'IDX_income_source_event'`,
    );
    if (Number(idx[0].c) > 0) await queryRunner.query(`DROP INDEX \`IDX_income_source_event\` ON \`income\``);
    if (await this.columnExists(queryRunner, 'income', 'sourceEventKey')) {
      await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`sourceEventKey\``);
    }
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add src/entities/income.entity.ts src/database/migrations/1786000000062-AddIncomeSourceEventKey.ts
git commit -m "feat(tracking-sync): ancla de cobro Income.sourceEventKey + migración 062"
```

---

## Task 2: Lógica cobrable pura (`deriveChargeableIncomes`)

**Files:**
- Create: `src/tracking-sync/rules/income.chargeable.ts`
- Test: `src/tracking-sync/rules/income.chargeable.spec.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `ShipmentStatusType`, `IncomeStatus`.
- Produces:
```ts
export interface ChargeableIncome {
  eventKey: string;
  incomeType: IncomeStatus;   // ENTREGADO | NO_ENTREGADO
  occurredAt: Date;
  exceptionCode: string;
  reason: string;             // 'ENTREGADO (DL)' | 'RECHAZADO (07)' | '3ra VISITA'
}
export function deriveChargeableIncomes(
  newEvents: NormalizedEvent[],
  existing08Count: number,
): ChargeableIncome[]
```
Espejo de `shipments.service.ts:8628-8640`. El `08` acumulado usa `existing08Count` (de BD) + los `08` nuevos en orden; dispara al llegar a 3. Devuelve **a lo sumo uno por evento** cobrable.

- [ ] **Step 1: Write the failing test**

```ts
import { deriveChargeableIncomes } from './income.chargeable';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

const ev = (over: any) => ({
  occurredAt: new Date(over.t || '2026-08-20T10:00:00Z'), derivedCode: null, statusCode: null,
  exceptionCode: over.ec ?? null, eventType: null, description: null, location: null,
  status: over.status, eventKey: over.k, shadowKey: over.k,
});

describe('deriveChargeableIncomes', () => {
  it('DL → ENTREGADO', () => {
    const out = deriveChargeableIncomes([ev({ k: 'e1', status: ShipmentStatusType.ENTREGADO })], 0);
    expect(out).toHaveLength(1);
    expect(out[0].incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(out[0].eventKey).toBe('e1');
  });
  it('07 / RECHAZADO → NO_ENTREGADO', () => {
    const out = deriveChargeableIncomes([ev({ k: 'e2', ec: '07', status: ShipmentStatusType.RECHAZADO })], 0);
    expect(out[0].incomeType).toBe(IncomeStatus.NO_ENTREGADO);
  });
  it('08 dispara solo en la 3ra visita (con 2 previas)', () => {
    const two = [ev({ k: 'a', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T10:00:00Z' })];
    expect(deriveChargeableIncomes(two, 2)).toHaveLength(1); // 2 previas + 1 nueva = 3
    expect(deriveChargeableIncomes(two, 1)).toHaveLength(0); // 1 + 1 = 2, aún no
  });
  it('estatus no cobrable → nada', () => {
    expect(deriveChargeableIncomes([ev({ k: 'x', status: ShipmentStatusType.EN_RUTA })], 0)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/tracking-sync/rules/income.chargeable.spec.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implement**

`src/tracking-sync/rules/income.chargeable.ts`:

```ts
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { NormalizedEvent } from '../tracking-sync.types';

export interface ChargeableIncome {
  eventKey: string;
  incomeType: IncomeStatus;
  occurredAt: Date;
  exceptionCode: string;
  reason: string;
}

/** Mirror de la lógica cobrable del legacy (shipments.service.ts:8628-8640), por evento. */
export function deriveChargeableIncomes(newEvents: NormalizedEvent[], existing08Count: number): ChargeableIncome[] {
  const out: ChargeableIncome[] = [];
  let count08 = existing08Count;
  // Orden cronológico para que la 3ra visita se cuente bien.
  const events = [...newEvents].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const e of events) {
    const ec = (e.exceptionCode ?? '').trim();
    if (e.status === ShipmentStatusType.ENTREGADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: 'ENTREGADO (DL)' });
    } else if (ec === '07' || e.status === ShipmentStatusType.RECHAZADO) {
      out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: `RECHAZADO (${ec || '07'})` });
    } else if (ec === '08') {
      count08++;
      if (count08 >= 3) {
        out.push({ eventKey: e.eventKey, incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: e.occurredAt, exceptionCode: ec, reason: '3ra VISITA' });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/tracking-sync/rules/income.chargeable.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/rules/income.chargeable.ts src/tracking-sync/rules/income.chargeable.spec.ts
git commit -m "feat(tracking-sync): lógica cobrable pura anclada al evento (deriveChargeableIncomes)"
```

---

## Task 3: Activar `IncomeRule` (encola efectos, no escribe)

**Files:**
- Modify: `src/tracking-sync/rules/income.rule.ts`

**Interfaces:**
- Consumes: `deriveChargeableIncomes` (Task 2), `SyncContext`, `DataSource` (para contar `08` previos).
- Produces: por cada evento cobrable nuevo, empuja `ctx.deferredEffects.push({ type: 'income', payload: ChargeableIncome & { trackingNumber, shipmentId, subsidiaryId } })`. Solo `kind==='shipment'`.

> **Nota de implementación:** `IncomeRule.apply` pasa a `async` (permitido por `SyncRule.apply: void|Promise<void>`). Inyecta `DataSource` para contar los `08` ya persistidos del envío:
> `SELECT COUNT(*) c FROM shipment_status WHERE shipmentId=? AND exceptionCode='08'`.
> Mantener `priority=10` (corre al final, tras terminal-lock/external-delivery, con el `proposedStatus` ya resuelto). Registrar `IncomeRule` sigue igual en el módulo (ya está en `SYNC_RULES`).

- [ ] **Step 1: Implement the rule**

```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SyncContext, SyncRule } from '../tracking-sync.types';
import { deriveChargeableIncomes } from './income.chargeable';

/**
 * Encola efectos de cobro (DeferredEffect type:'income') anclados al evento terminal.
 * NO escribe: el IncomeExecutor los materializa (report en shadow, persist en cutover).
 * Solo aplica a envíos normales; las cargas F2 no cobran por paquete.
 */
@Injectable()
export class IncomeRule implements SyncRule {
  readonly name = 'income';
  readonly priority = 10;

  constructor(private readonly dataSource: DataSource) {}

  async apply(ctx: SyncContext): Promise<void> {
    if (ctx.kind !== 'shipment') return;
    const newEvents = ctx.reconcile.newEvents || [];
    if (newEvents.length === 0) return;

    const has08 = newEvents.some((e) => (e.exceptionCode ?? '').trim() === '08');
    let existing08 = 0;
    if (has08) {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS c FROM shipment_status WHERE shipmentId = ? AND exceptionCode = '08'`,
        [ctx.shipment.id],
      );
      existing08 = Number(rows?.[0]?.c ?? 0);
    }

    const chargeables = deriveChargeableIncomes(newEvents, existing08);
    for (const ci of chargeables) {
      ctx.deferredEffects.push({
        type: 'income',
        payload: {
          ...ci,
          trackingNumber: ctx.shipment.trackingNumber,
          shipmentId: ctx.shipment.id,
          subsidiaryId: (ctx.shipment.subsidiary as any)?.id ?? null,
        },
      });
    }
  }
}
```

- [ ] **Step 2: Verify DI wiring** — `IncomeRule` ya está en `providers` y `SYNC_RULES` del módulo; solo agrega la dependencia `DataSource` (ya disponible globalmente por TypeORM). Build:

Run: `npm run build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add src/tracking-sync/rules/income.rule.ts
git commit -m "feat(tracking-sync): IncomeRule encola efectos de cobro anclados al evento (kind=shipment)"
```

---

## Task 4: `IncomeExecutor` (report | persist, idempotente por sourceEventKey)

**Files:**
- Create: `src/tracking-sync/income/income-executor.ts`
- Test: `src/tracking-sync/income/income-executor.spec.ts`

**Interfaces:**
- Consumes: `Income`/`Subsidiary` repos, `DataSource`.
- Produces:
```ts
export type IncomeMode = 'report' | 'persist';
export interface ProposedIncome { trackingNumber: string; incomeType: IncomeStatus; sourceEventKey: string; cost: number; occurredAt: Date; subsidiaryId: string | null; shipmentId: string; exists: boolean; }
class IncomeExecutor {
  // Calcula los ingresos propuestos desde ctx.deferredEffects y, si mode==='persist',
  // inserta los que no existan (idempotente por (trackingNumber, incomeType, sourceEventKey)).
  async execute(effects: DeferredEffect[], mode: IncomeMode): Promise<ProposedIncome[]>
}
```

> **Nota:** el costo por guía se resuelve igual que `generateIncomes` (`shipments.service.ts:3051-3061`): `subsidiary.fedexCostPackage` (o `dhlCostPackage` si DHL); fallback a query de la sucursal. En `report` NO inserta; solo marca `exists` (si ya hay Income con ese `sourceEventKey`).

- [ ] **Step 1: Write the failing test**

```ts
import { IncomeExecutor } from './income-executor';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

function repoMock(extra: any = {}) { return { findOne: jest.fn(), find: jest.fn(), create: jest.fn((x) => x), save: jest.fn(async (x) => x), ...extra }; }

describe('IncomeExecutor', () => {
  it('report: NO inserta; marca exists según sourceEventKey', async () => {
    const incomeRepo = repoMock({ findOne: jest.fn().mockResolvedValue({ id: 'i1' }) });
    const subRepo = repoMock({ findOne: jest.fn().mockResolvedValue({ fedexCostPackage: 50 }) });
    const ds: any = { getRepository: (e: any) => (String(e).includes('Income') ? incomeRepo : subRepo), transaction: jest.fn() };
    const exec = new IncomeExecutor(ds);
    const effects = [{ type: 'income', payload: { eventKey: 'k1', incomeType: IncomeStatus.ENTREGADO, occurredAt: new Date(), trackingNumber: 'T1', shipmentId: 's1', subsidiaryId: 'sub1' } }];
    const out = await exec.execute(effects as any, 'report');
    expect(out).toHaveLength(1);
    expect(out[0].exists).toBe(true);
    expect(incomeRepo.save).not.toHaveBeenCalled();
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it('persist: inserta el ingreso faltante anclado al eventKey', async () => {
    const saved: any[] = [];
    const m = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((_e, x) => x), save: jest.fn(async (_e, x) => { saved.push(x); return x; }), getRepository: () => ({ findOne: jest.fn().mockResolvedValue({ fedexCostPackage: 50 }) }) };
    const ds: any = {
      getRepository: () => ({ findOne: jest.fn().mockResolvedValue(null) }),
      transaction: async (fn: any) => fn(m),
    };
    const exec = new IncomeExecutor(ds);
    const effects = [{ type: 'income', payload: { eventKey: 'k2', incomeType: IncomeStatus.NO_ENTREGADO, occurredAt: new Date(), trackingNumber: 'T2', shipmentId: 's2', subsidiaryId: 'sub1', exceptionCode: '07' } }];
    const out = await exec.execute(effects as any, 'persist');
    expect(out[0].exists).toBe(false);
    expect(saved.some((s) => s.sourceEventKey === 'k2' && s.cost === 50)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/tracking-sync/income/income-executor.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (usa `Income`, `Subsidiary`, `IncomeSourceType`, `ShipmentType`)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Income } from 'src/entities/income.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { DeferredEffect } from '../tracking-sync.types';

export type IncomeMode = 'report' | 'persist';
export interface ProposedIncome {
  trackingNumber: string; incomeType: IncomeStatus; sourceEventKey: string;
  cost: number; occurredAt: Date; subsidiaryId: string | null; shipmentId: string; exists: boolean;
}

@Injectable()
export class IncomeExecutor {
  private readonly logger = new Logger(IncomeExecutor.name);
  constructor(private readonly dataSource: DataSource) {}

  private async resolveCost(subsidiaryId: string | null): Promise<number> {
    if (!subsidiaryId) return 0;
    const sub = await this.dataSource.getRepository(Subsidiary).findOne({ where: { id: subsidiaryId }, select: ['fedexCostPackage'] as any });
    return Number((sub as any)?.fedexCostPackage ?? 0);
  }

  async execute(effects: DeferredEffect[], mode: IncomeMode): Promise<ProposedIncome[]> {
    const incomeEffects = (effects || []).filter((e) => e.type === 'income');
    const out: ProposedIncome[] = [];
    for (const e of incomeEffects) {
      const p = e.payload as any;
      const cost = await this.resolveCost(p.subsidiaryId);
      const existing = await this.dataSource.getRepository(Income).findOne({
        where: { trackingNumber: p.trackingNumber, incomeType: p.incomeType, sourceEventKey: p.eventKey } as any,
        select: ['id'] as any,
      });
      const proposed: ProposedIncome = {
        trackingNumber: p.trackingNumber, incomeType: p.incomeType, sourceEventKey: p.eventKey,
        cost, occurredAt: new Date(p.occurredAt), subsidiaryId: p.subsidiaryId, shipmentId: p.shipmentId, exists: !!existing,
      };
      out.push(proposed);

      if (mode === 'persist' && !existing) {
        if (cost <= 0) { this.logger.error(`FINANCE_ERROR cobro $0 guía ${p.trackingNumber}`); continue; }
        await this.dataSource.transaction(async (m) => {
          const dup = await m.findOne(Income, { where: { trackingNumber: p.trackingNumber, incomeType: p.incomeType, sourceEventKey: p.eventKey } as any, select: ['id'] as any });
          if (dup) return; // carrera: otro proceso ya insertó
          const row = m.create(Income, {
            trackingNumber: p.trackingNumber, shipment: { id: p.shipmentId }, subsidiary: { id: p.subsidiaryId },
            shipmentType: ShipmentType.FEDEX, cost, incomeType: p.incomeType, nonDeliveryStatus: p.exceptionCode ?? '',
            isGrouped: false, sourceType: IncomeSourceType.SHIPMENT, date: new Date(p.occurredAt),
            sourceEventKey: p.eventKey, createdAt: new Date(),
          } as any);
          await m.save(Income, row);
        });
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/tracking-sync/income/income-executor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/income/income-executor.ts src/tracking-sync/income/income-executor.spec.ts
git commit -m "feat(tracking-sync): IncomeExecutor idempotente por sourceEventKey (report|persist)"
```

---

## Task 5: `IncomeReconciler` (shadow) + wiring en el orquestador

**Files:**
- Create: `src/tracking-sync/income/income-reconciler.ts`
- Test: `src/tracking-sync/income/income-reconciler.spec.ts`
- Modify: `src/tracking-sync/tracking-sync.module.ts` (registrar `IncomeExecutor`, `IncomeReconciler`)
- Modify: `src/tracking-sync/tracking-sync.orchestrator.ts` (invocar reconciler en `runShadow`, contar divergencias)

**Interfaces:**
- Consumes: `IncomeExecutor.execute(effects, 'report')`.
- Produces:
```ts
export interface IncomeReconcileRow { trackingNumber: string; incomeType: string; sourceEventKey: string; wouldGenerate: boolean; alreadyExists: boolean; missing: boolean; cost: number; }
class IncomeReconciler { async reconcile(effects: DeferredEffect[]): Promise<{ rows: IncomeReconcileRow[]; missingCount: number; okCount: number }> }
```
`missing` = el motor generaría un cobro que HOY no existe (posible cobro que el legacy no captó, o divergencia a revisar). `alreadyExists` = ya está (paridad).

- [ ] **Step 1: Write the failing test**

```ts
import { IncomeReconciler } from './income-reconciler';

describe('IncomeReconciler', () => {
  it('clasifica missing vs ya-existe', async () => {
    const exec: any = { execute: jest.fn().mockResolvedValue([
      { trackingNumber: 'A', incomeType: 'entregado', sourceEventKey: 'k1', cost: 50, exists: false, occurredAt: new Date(), subsidiaryId: 's', shipmentId: 'x' },
      { trackingNumber: 'B', incomeType: 'entregado', sourceEventKey: 'k2', cost: 50, exists: true, occurredAt: new Date(), subsidiaryId: 's', shipmentId: 'y' },
    ]) };
    const rec = new IncomeReconciler(exec);
    const r = await rec.reconcile([{ type: 'income', payload: {} }] as any);
    expect(r.missingCount).toBe(1);
    expect(r.okCount).toBe(1);
    expect(r.rows.find((x) => x.trackingNumber === 'A')!.missing).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/tracking-sync/income/income-reconciler.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { DeferredEffect } from '../tracking-sync.types';
import { IncomeExecutor } from './income-executor';

export interface IncomeReconcileRow {
  trackingNumber: string; incomeType: string; sourceEventKey: string;
  wouldGenerate: boolean; alreadyExists: boolean; missing: boolean; cost: number;
}

@Injectable()
export class IncomeReconciler {
  constructor(private readonly executor: IncomeExecutor) {}

  async reconcile(effects: DeferredEffect[]): Promise<{ rows: IncomeReconcileRow[]; missingCount: number; okCount: number }> {
    const proposed = await this.executor.execute(effects, 'report');
    const rows: IncomeReconcileRow[] = proposed.map((p) => ({
      trackingNumber: p.trackingNumber, incomeType: String(p.incomeType), sourceEventKey: p.sourceEventKey,
      wouldGenerate: true, alreadyExists: p.exists, missing: !p.exists, cost: p.cost,
    }));
    const missingCount = rows.filter((r) => r.missing).length;
    return { rows, missingCount, okCount: rows.length - missingCount };
  }
}
```

- [ ] **Step 4: Register providers in the module**

En `src/tracking-sync/tracking-sync.module.ts`, agregar a `providers`: `IncomeExecutor`, `IncomeReconciler`, y a `imports` `TypeOrmModule.forFeature([... , Income, Subsidiary])` si no están. (Import de `../income/...`.)

- [ ] **Step 5: Wire into `runShadow`**

En `tracking-sync.orchestrator.ts` `runShadow(...)`, tras construir el `SyncContext` de cada item (donde ya se corren las reglas y por tanto `ctx.deferredEffects` trae los efectos de cobro), invocar `this.incomeReconciler.reconcile(ctx.deferredEffects)` y acumular `missingCount`/`okCount`; loguear el resumen `🧾 [shadow-cobros] propondría N (faltan M, ya existen K)`. Inyectar `IncomeReconciler` en el constructor del orquestador.

> **Nota de implementación:** leer `tracking-sync.orchestrator.ts:35-95` para insertar la llamada donde el `ctx` ya tiene las reglas aplicadas; no cambiar la lógica de estatus existente (solo agregar la contabilidad de cobros).

- [ ] **Step 6: Run tests + build**

Run: `npx jest src/tracking-sync/income && npm run build`
Expected: PASS + compila.

- [ ] **Step 7: Commit**

```bash
git add src/tracking-sync/income/income-reconciler.ts src/tracking-sync/income/income-reconciler.spec.ts src/tracking-sync/tracking-sync.module.ts src/tracking-sync/tracking-sync.orchestrator.ts
git commit -m "feat(tracking-sync): IncomeReconciler en shadow + resumen de paridad de cobros"
```

---

## Task 6: Verificación (migración + shadow) — con visto bueno del usuario

- [ ] **Step 1:** `npm run migration:run` (solo la 062 estará pendiente) → agrega `income.sourceEventKey`.
- [ ] **Step 2:** Levantar el API; en la próxima corrida shadow (:15) revisar el log `🧾 [shadow-cobros] propondría N (faltan M, ya existen K)`. `M` alto = revisar reglas antes del cutover.
- [ ] **Step 3:** `npx jest src/tracking-sync` — suite del motor completa en verde (sin regresiones).

---

## Self-Review (cobertura)

- Ancla de cobro → Task 1. Lógica cobrable → Task 2. Encolado → Task 3. Materialización idempotente (report|persist) → Task 4. Reconciliación shadow + observabilidad → Task 5. Verificación → Task 6.
- **Fuera de este plan (fases siguientes):** cutover de estatus (F3), activar `persist` de cobros (F4), cadencia adaptativa + on-demand + primer-sync import-jobs (F5), reconciliador diario + SLA (F6). Cada una es aditiva y detrás de bandera.
- **Requiere leer en ejecución:** `tracking-sync.orchestrator.ts:35-95` (punto de inserción del reconciler) — reuso, no reescritura.
