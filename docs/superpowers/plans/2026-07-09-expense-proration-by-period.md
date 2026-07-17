# Expense Proration by Period Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prorate recurring expenses across an explicitly-captured coverage period so the dashboard KPIs and the Excel "Estado de Resultados" report show the same per-day and total expense figures, derived from a single expense record.

**Architecture:** Add `periodStart`/`periodEnd` (DATE) to the `expense` row. A single pure helper computes, from that one record, both the amount an expense contributes to a query range (overlap-based) and its per-day share. Both the dashboard (`kpi.service`) and the report (`resports.service`) call that helper — no extra tables, no materialized daily rows, computed on read. Expenses without a period stay point expenses on their `date` (full amount that day). This also removes the buggy `calculateDailyExpense`/`txCount` proration.

**Tech Stack:** NestJS, TypeORM (MySQL, connection `timezone: "Z"`), Jest, raw SQL migration.

## Global Constraints

- Canonical business day = America/Hermosillo (UTC-7, no DST). `expense.date`, `expense.periodStart`, `expense.periodEnd` are all calendar-day `DATE` columns, returned by TypeORM as `'YYYY-MM-DD'` strings.
- Day strings compare correctly with `<`, `<=`, `>=` (lexicographic == chronological for `YYYY-MM-DD`). Do proration math on day strings — never build `Date` objects from them (avoids UTC/offset day-roll).
- Coerce any incoming date/period value to a Hermosillo calendar day via `toHermosilloDateString(input)` from `src/common/utils.ts` (string input → first 10 chars; Date input → Hermosillo day). Reuse it; never reimplement.
- One expense record is the single source of truth. No extra tables, no per-day rows, no duplicated data.
- MySQL may lack named-tz tables → never use tz names in SQL.
- Invariant that MUST hold: for any expense and any range, `proratedAmountInRange` equals the sum of `dailyShareForDay` over every day in that range. Dashboard total and Excel daily columns therefore reconcile by construction.
- Only expense proration changes. Income/shipment/charge/consolidated logic is untouched.

---

### Task 1: Shared proration helper

**Files:**
- Create: `src/common/expense-proration.util.ts`
- Test: `src/common/expense-proration.util.spec.ts`

**Interfaces:**
- Produces:
  - `interface ProratableExpense { amount: number | string; date: string; periodStart?: string | null; periodEnd?: string | null; }`
  - `dayCountInclusive(startDay: string, endDay: string): number` — inclusive day count; `<= 0` when `endDay < startDay`.
  - `proratedAmountInRange(exp: ProratableExpense, rangeStart: string, rangeEnd: string): number` — amount the expense contributes to `[rangeStart, rangeEnd]`.
  - `dailyShareForDay(exp: ProratableExpense, day: string): number` — the expense's share on a single day.

- [ ] **Step 1: Write the failing test**

```ts
// src/common/expense-proration.util.spec.ts
import {
  dayCountInclusive,
  proratedAmountInRange,
  dailyShareForDay,
  ProratableExpense,
} from './expense-proration.util';

describe('expense-proration', () => {
  it('dayCountInclusive counts both ends', () => {
    expect(dayCountInclusive('2026-06-27', '2026-07-03')).toBe(7);
    expect(dayCountInclusive('2026-07-01', '2026-07-01')).toBe(1);
    expect(dayCountInclusive('2026-07-03', '2026-07-01')).toBeLessThanOrEqual(0);
  });

  const payroll: ProratableExpense = {
    amount: 7000, date: '2026-07-04', periodStart: '2026-06-27', periodEnd: '2026-07-03',
  };

  it('prorates by overlap with the query range', () => {
    // 7-day period, $7000 => $1000/day. July range overlaps Jul 1-3 = 3 days => 3000.
    expect(proratedAmountInRange(payroll, '2026-07-01', '2026-07-31')).toBeCloseTo(3000, 6);
    // June range overlaps Jun 27-30 = 4 days => 4000.
    expect(proratedAmountInRange(payroll, '2026-06-01', '2026-06-30')).toBeCloseTo(4000, 6);
    // No overlap => 0.
    expect(proratedAmountInRange(payroll, '2026-08-01', '2026-08-31')).toBe(0);
  });

  it('daily share is amount / periodDays on covered days, 0 otherwise', () => {
    expect(dailyShareForDay(payroll, '2026-07-02')).toBeCloseTo(1000, 6);
    expect(dailyShareForDay(payroll, '2026-07-04')).toBe(0); // registration day, outside period
    expect(dailyShareForDay(payroll, '2026-06-27')).toBeCloseTo(1000, 6);
  });

  it('point expense (no period) lands fully on its date', () => {
    const fuel: ProratableExpense = { amount: 450, date: '2026-07-02' };
    expect(proratedAmountInRange(fuel, '2026-07-01', '2026-07-31')).toBe(450);
    expect(proratedAmountInRange(fuel, '2026-08-01', '2026-08-31')).toBe(0);
    expect(dailyShareForDay(fuel, '2026-07-02')).toBe(450);
    expect(dailyShareForDay(fuel, '2026-07-03')).toBe(0);
  });

  it('INVARIANT: sum of daily shares over a range equals proratedAmountInRange', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
    const sum = days.reduce((s, d) => s + dailyShareForDay(payroll, d), 0);
    expect(sum).toBeCloseTo(proratedAmountInRange(payroll, '2026-07-01', '2026-07-05'), 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/common/expense-proration.util.spec.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Write the implementation**

```ts
// src/common/expense-proration.util.ts

export interface ProratableExpense {
  amount: number | string;
  date: string;                 // 'YYYY-MM-DD'
  periodStart?: string | null;  // 'YYYY-MM-DD' or null
  periodEnd?: string | null;    // 'YYYY-MM-DD' or null
}

const MS_PER_DAY = 86_400_000;

function toUtcMs(day: string): number {
  return Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`);
}

/** Inclusive count of calendar days from startDay to endDay. <= 0 if endDay < startDay. */
export function dayCountInclusive(startDay: string, endDay: string): number {
  return Math.round((toUtcMs(endDay) - toUtcMs(startDay)) / MS_PER_DAY) + 1;
}

function hasPeriod(exp: ProratableExpense): exp is ProratableExpense & { periodStart: string; periodEnd: string } {
  return !!exp.periodStart && !!exp.periodEnd;
}

/** Amount this expense contributes to [rangeStart, rangeEnd] (day strings, inclusive). */
export function proratedAmountInRange(exp: ProratableExpense, rangeStart: string, rangeEnd: string): number {
  const amount = Number(exp.amount || 0);
  if (!hasPeriod(exp)) {
    const d = String(exp.date).slice(0, 10);
    return d >= rangeStart && d <= rangeEnd ? amount : 0;
  }
  const periodDays = dayCountInclusive(exp.periodStart, exp.periodEnd);
  if (periodDays <= 0) return 0;
  const ovStart = exp.periodStart > rangeStart ? exp.periodStart : rangeStart;
  const ovEnd = exp.periodEnd < rangeEnd ? exp.periodEnd : rangeEnd;
  const overlap = dayCountInclusive(ovStart, ovEnd);
  if (overlap <= 0) return 0;
  return (amount * overlap) / periodDays;
}

/** This expense's share on a single day. */
export function dailyShareForDay(exp: ProratableExpense, day: string): number {
  const amount = Number(exp.amount || 0);
  if (!hasPeriod(exp)) {
    return String(exp.date).slice(0, 10) === day ? amount : 0;
  }
  if (day < exp.periodStart || day > exp.periodEnd) return 0;
  const periodDays = dayCountInclusive(exp.periodStart, exp.periodEnd);
  if (periodDays <= 0) return 0;
  return amount / periodDays;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/common/expense-proration.util.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/expense-proration.util.ts src/common/expense-proration.util.spec.ts
git commit -m "feat(expenses): add period-based proration helper"
```

---

### Task 2: Entity fields + migration

**Files:**
- Modify: `src/entities/expense.entity.ts` (add two columns after the `date` column, ~line 36)
- Create: `src/database/migrations/1786000000029-AddExpensePeriod.ts`

**Interfaces:**
- Produces: `Expense.periodStart?: string` and `Expense.periodEnd?: string` (DATE columns, nullable). DB columns `periodStart`, `periodEnd` of type `DATE`.

- [ ] **Step 1: Add the entity columns**

In `src/entities/expense.entity.ts`, immediately after the `date` column (`@Column({ type: 'date' }) date: string;`), add:

```ts
  @Column({ type: 'date', nullable: true })
  periodStart?: string;

  @Column({ type: 'date', nullable: true })
  periodEnd?: string;
```

- [ ] **Step 2: Write the migration**

```ts
// src/database/migrations/1786000000029-AddExpensePeriod.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Periodo de cobertura del gasto para prorratear (día calendario Hermosillo).
 * Nullable: los gastos sin periodo se tratan como puntuales en su `date`.
 * No requiere backfill — los existentes se quedan como puntuales.
 */
export class AddExpensePeriod1786000000029 implements MigrationInterface {
  name = 'AddExpensePeriod1786000000029';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` ADD COLUMN `periodStart` DATE NULL');
    await q.query('ALTER TABLE `expense` ADD COLUMN `periodEnd` DATE NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` DROP COLUMN `periodEnd`');
    await q.query('ALTER TABLE `expense` DROP COLUMN `periodStart`');
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors (only the 2 pre-existing `src/auth/*.spec.ts` module errors may remain).

- [ ] **Step 4: Commit**

```bash
git add src/entities/expense.entity.ts src/database/migrations/1786000000029-AddExpensePeriod.ts
git commit -m "feat(expenses): add periodStart/periodEnd DATE columns"
```

> Note: `npm run migration:run` is DEFERRED to the user (no DB in this environment).

---

### Task 3: Persist + validate the period on write

**Files:**
- Modify: `src/expenses/expenses.service.ts` (`create`, ~lines 21-26)
- Test: `src/expenses/expenses.service.spec.ts` (extend the existing suite)

**Interfaces:**
- Consumes: `toHermosilloDateString` (from `src/common/utils`), `BadRequestException` (already imported at top of the service).
- Produces: `create` coerces `periodStart`/`periodEnd` to Hermosillo day strings and enforces both-or-neither + `periodStart <= periodEnd`.

- [ ] **Step 1: Write the failing tests (append to the existing describe block)**

```ts
// add inside src/expenses/expenses.service.spec.ts

  it('coerces period bounds to Hermosillo day strings', async () => {
    const { service, saved } = makeService();
    await service.create({
      date: '2026-07-04',
      amount: 7000,
      periodStart: '2026-06-27T06:00:00.000Z',
      periodEnd: '2026-07-03T06:00:00.000Z',
    } as any);
    expect(saved[0].periodStart).toBe('2026-06-27');
    expect(saved[0].periodEnd).toBe('2026-07-03');
  });

  it('rejects a period with only one bound', async () => {
    const { service } = makeService();
    await expect(
      service.create({ date: '2026-07-04', amount: 100, periodStart: '2026-07-01' } as any),
    ).rejects.toThrow();
  });

  it('rejects an inverted period', async () => {
    const { service } = makeService();
    await expect(
      service.create({ date: '2026-07-04', amount: 100, periodStart: '2026-07-10', periodEnd: '2026-07-01' } as any),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/expenses/expenses.service.spec.ts`
Expected: the three new tests FAIL (period not coerced / no validation).

- [ ] **Step 3: Implement in `create`**

Replace the body of `create` in `src/expenses/expenses.service.ts` with:

```ts
  async create(createExpenseDto: Expense) {
    createExpenseDto.date = toHermosilloDateString(createExpenseDto.date || new Date());

    const hasStart = !!createExpenseDto.periodStart;
    const hasEnd = !!createExpenseDto.periodEnd;
    if (hasStart !== hasEnd) {
      throw new BadRequestException('periodStart y periodEnd deben especificarse juntos.');
    }
    if (hasStart && hasEnd) {
      const start = toHermosilloDateString(createExpenseDto.periodStart!);
      const end = toHermosilloDateString(createExpenseDto.periodEnd!);
      if (start > end) {
        throw new BadRequestException('periodStart no puede ser posterior a periodEnd.');
      }
      createExpenseDto.periodStart = start;
      createExpenseDto.periodEnd = end;
    }

    const newExpense = this.expenseRepository.create(createExpenseDto);
    return await this.expenseRepository.save(newExpense);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/expenses/expenses.service.spec.ts`
Expected: PASS (all tests, including the 2 prior date tests).

- [ ] **Step 5: Commit**

```bash
git add src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts
git commit -m "feat(expenses): persist and validate coverage period on create"
```

---

### Task 4: Dashboard KPIs use period proration

**Files:**
- Modify: `src/dashboard/kpi.service.ts` — delete dead method `getSubsidiariesKpisResp0205` (lines ~164-349), rewrite the expense query + reduce in the active `getSubsidiariesKpis`, delete `calculateDailyExpense` (~lines 555-569), remove now-unused `Frequency` import.

**Interfaces:**
- Consumes: `proratedAmountInRange` from `src/common/expense-proration.util`; `baseStartDate`/`baseEndDate` (`'YYYY-MM-DD'` strings already computed in the method).

- [ ] **Step 1: Delete the dead method**

Delete the entire unused method `async getSubsidiariesKpisResp0205(...) { ... }` (from its signature through its closing brace, ~lines 164-349). It has no callers (controller uses `getSubsidiariesKpis`).

- [ ] **Step 2: Add the import**

At the top of `src/dashboard/kpi.service.ts`, add:

```ts
import { proratedAmountInRange } from 'src/common/expense-proration.util';
```

- [ ] **Step 3: Rewrite the expense query in `getSubsidiariesKpis`**

Replace the `-- C. ESTADÍSTICAS DE GASTOS` query (the `this.expenseRepository.createQueryBuilder('expense')...getRawMany()` block) with one that returns the overlapping expense ENTITIES (period-aware), instead of a pre-aggregation. Use `.getMany()` (not `getRawMany`) so the `DATE` columns come back as `'YYYY-MM-DD'` strings via TypeORM's transformer — `getRawMany` would hand back raw driver values (MySQL `DATE` can arrive as a JS `Date`, breaking the day-string comparisons in the helper):

```ts
      // -- C. GASTOS (entidades que traslapan el rango; se prorratean en JS por periodo) --
      this.expenseRepository.createQueryBuilder('expense')
        .where(new Brackets(qb => {
          qb.where('expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay', { startDay: baseStartDate, endDay: baseEndDate })
            .orWhere('(expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate });
        }))
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .getMany(),
```

(`Brackets` is already imported in this file.) `expenseStats` is now `Expense[]`; each element exposes `subsidiaryId`, `amount`, `date`, `periodStart`, `periodEnd` as typed entity fields.

- [ ] **Step 4: Rewrite the expense reduce**

Replace the `subExpenses`/`totalExpenses` block (~lines 485-498) with:

```ts
      const subExpenses = expenseStats.filter(e => e.subsidiaryId === subsidiary.id);
      const totalExpenses = subExpenses.reduce(
        (sum, e) => sum + proratedAmountInRange(
          { amount: e.amount, date: e.date, periodStart: e.periodStart, periodEnd: e.periodEnd },
          baseStartDate,
          baseEndDate,
        ),
        0,
      );
```

- [ ] **Step 5: Delete `calculateDailyExpense` and the unused import**

Delete the private `calculateDailyExpense(...)` method (~lines 555-569). Then remove the now-unused `import { Frequency } from 'src/common/enums/frequency-enum';` line (the reduces no longer reference `Frequency`).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors in `kpi.service.ts`; only the 2 pre-existing `src/auth/*.spec.ts` errors remain. (If tsc flags the local `daysInDateRange` as unused, leave it — it is harmless; do not remove unrelated code.)

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/kpi.service.ts
git commit -m "feat(dashboard): prorate expenses by period; drop calculateDailyExpense and dead method"
```

---

### Task 5: Excel report prorates expenses by period

**Files:**
- Modify: `src/resports/resports.service.ts` — the `allExpenses` query (~lines 58-62) and the expense pivot loop (~lines 90-96).

**Interfaces:**
- Consumes: `dailyShareForDay` from `src/common/expense-proration.util`; `dateKeys` (`'YYYY-MM-DD'` day strings already built for the report columns); `baseStartDate`/`baseEndDate`.

- [ ] **Step 1: Add the import**

At the top of `src/resports/resports.service.ts`, add:

```ts
import { dailyShareForDay } from 'src/common/expense-proration.util';
```

- [ ] **Step 2: Make the expense query period-aware**

Replace the `allExpenses` query's `.andWhere(...)` (currently `expense.date >= :startDay AND expense.date <= :endDay`) so expenses whose period overlaps the range are also returned:

```ts
    const allExpenses = await this.expenseRepository
      .createQueryBuilder('expense')
      .where(expenseSubsidiaryCondition, { subsidiaryIds })
      .andWhere(
        '((expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay) OR ((expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay))',
        { startDay: baseStartDate, endDay: baseEndDate },
      )
      .getMany();
```

- [ ] **Step 3: Distribute each expense per day via the shared helper**

Replace the `allExpenses.forEach(...)` pivot block (~lines 90-96) with:

```ts
    allExpenses.forEach(exp => {
      const cat = exp.category || 'Gasto General';
      if (!expenseMatrix.has(cat)) expenseMatrix.set(cat, new Map<string, number>());
      const catMap = expenseMatrix.get(cat)!;
      for (const dKey of dateKeys) {
        const share = dailyShareForDay(
          { amount: exp.amount, date: exp.date, periodStart: exp.periodStart, periodEnd: exp.periodEnd },
          dKey,
        );
        if (share !== 0) catMap.set(dKey, (catMap.get(dKey) || 0) + share);
      }
    });
```

This spreads each expense's daily share into the report's day columns; the row totals and grand total then equal the in-range prorated amount (same value the dashboard reports). The "Desglose Detallado" sheet (line ~200) keeps listing each raw expense record with its full `amount` — it is the source ledger, intentionally not prorated.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors in `resports.service.ts`; only the 2 pre-existing `src/auth/*.spec.ts` errors remain.

- [ ] **Step 5: Commit**

```bash
git add src/resports/resports.service.ts
git commit -m "fix(reports): prorate expenses by period across daily columns"
```

---

### Task 6: Verification & reconciliation check

**Files:** none (verification only)

- [ ] **Step 1: Run the proration + expense unit suites**

Run: `npx jest src/common/expense-proration.util.spec.ts src/common/utils.spec.ts src/expenses/expenses.service.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: only the 2 pre-existing unrelated `src/auth/*.spec.ts` errors.

- [ ] **Step 3: Confirm no regression in the full suite baseline**

Run: `npx jest 2>&1 | tail -5`
Expected: the same 11 pre-existing scaffold-spec suites fail as before (app/auth/pick-up/resports/routeclosure/users controllers+services); the proration/utils/expenses suites pass. No newly-broken suite.

- [ ] **Step 4: End-to-end reconciliation (DEFERRED — needs the migration run on a DB)**

After the user runs `npm run migration:run` and captures a couple of expenses WITH a period:
- Call `/dashboard/subsidiary-metrics?startDate=...&endDate=...&subsidiaryIds=<sub>` and note `totalExpenses`.
- Download `/reports/income-statement?startDate=...&endDate=...&subsidiaryIds=<sub>` and read `TOTAL EGRESOS`.
- Expected: the two numbers are **equal** for the same range (reconciliation goal). A payroll of $7,000 for period Jun 27–Jul 3 shows $3,000 in a July-only range on both.

---

## Notes / Out of Scope

- **Frontend:** the expense form must capture `periodStart`/`periodEnd` (desde/hasta) for recurring expenses. The API tolerates offset-bearing ISO values (takes the wall-clock day), but plain `YYYY-MM-DD` is the contract. This lives in the web repo.
- Existing expenses without a period stay point expenses on their `date` (no backfill); users will update them.
- `frequency` remains a stored label / UI hint to prefill the period; it is NOT used in the proration math.
- Migration run and the e2e reconciliation are deferred to an environment with a live DB.
