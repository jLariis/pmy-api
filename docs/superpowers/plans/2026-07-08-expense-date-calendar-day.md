# Expense Date → Calendar Day (DATE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store `expense.date` as a timezone-free calendar day (`DATE`) anchored to America/Hermosillo, so the dashboard (and every other consumer) counts each expense on the day it actually belongs to.

**Architecture:** An expense is a calendar-day fact, not an instant. We migrate the `expense.date` column from `datetime` (currently a mix of Central-anchored `06:00:00Z` midnights and real UTC instants) to `DATE`. A one-time backfill normalizes existing rows to their Hermosillo calendar day, distinguishing the two historical shapes. All write paths coerce incoming values to a `YYYY-MM-DD` day; all read/query paths compare against date-only bounds — removing timezone math from expenses entirely.

**Tech Stack:** NestJS, TypeORM (MySQL, connection `timezone: "Z"`), Jest, `date-fns-tz`, raw SQL migration.

## Global Constraints

- Canonical business timezone for "the day": **America/Hermosillo (UTC-7, no DST)** — matches crons, package-dispatch, inventories, reports, dashboard.
- MySQL server may **not** have named timezone tables loaded → use **numeric offsets** (`'+00:00'`, `'-07:00'`) with `CONVERT_TZ`, never `'America/Hermosillo'` inside SQL.
- After migration, TypeORM returns a `DATE` column as a **`string` `'YYYY-MM-DD'`**, not a `Date`. The entity field type changes to `string`.
- Column name stays `date` (many consumers reference it). Preserve `NOT NULL`.
- Do not change the semantics of `income.date`, `shipment.createdAt`, `charge.chargeDate`, or `cons.date` — this plan touches **expenses only**.

---

### Task 1: Hermosillo calendar-day helper

**Files:**
- Modify: `src/common/utils.ts` (append new export)
- Test: `src/common/utils.spec.ts` (create)

**Interfaces:**
- Produces: `toHermosilloDateString(input: string | Date): string` — returns a `'YYYY-MM-DD'` calendar day. For a **string** input it returns the first 10 chars (the wall-clock day the user picked, offset-agnostic). For a **Date** input it returns the Hermosillo (UTC-7) calendar day of that instant.

- [ ] **Step 1: Write the failing test**

```ts
// src/common/utils.spec.ts
import { toHermosilloDateString } from './utils';

describe('toHermosilloDateString', () => {
  it('takes the wall-clock day from a date-only string', () => {
    expect(toHermosilloDateString('2026-07-06')).toBe('2026-07-06');
  });

  it('takes the wall-clock day from an ISO string regardless of offset (Central midnight => 06:00Z)', () => {
    // This is exactly how legacy date-only expenses arrive from the front.
    expect(toHermosilloDateString('2026-07-06T06:00:00.000Z')).toBe('2026-07-06');
    expect(toHermosilloDateString('2026-07-06T00:00:00.000-06:00')).toBe('2026-07-06');
  });

  it('converts a real Date instant to its Hermosillo calendar day', () => {
    // 2026-07-06 03:00Z => Hermosillo 2026-07-05 20:00 => day 2026-07-05
    expect(toHermosilloDateString(new Date('2026-07-06T03:00:00.000Z'))).toBe('2026-07-05');
    // 2026-07-06 13:00Z => Hermosillo 2026-07-06 06:00 => day 2026-07-06
    expect(toHermosilloDateString(new Date('2026-07-06T13:00:00.000Z'))).toBe('2026-07-06');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/common/utils.spec.ts -t toHermosilloDateString`
Expected: FAIL — `toHermosilloDateString is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Append to src/common/utils.ts
import { formatInTimeZone } from 'date-fns-tz';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}/;

/**
 * Devuelve el DÍA CALENDARIO 'YYYY-MM-DD' de un gasto, anclado a Hermosillo.
 * - string: toma el día de reloj tal cual (primeros 10 chars). Esto respeta el
 *   día que el usuario eligió aunque el front le cuelgue un offset (-06 => 06:00Z).
 * - Date (instante real, p.ej. importación Excel con new Date()): lo convierte
 *   al día calendario de Hermosillo (UTC-7).
 */
export function toHermosilloDateString(input: string | Date): string {
  if (typeof input === 'string' && YYYY_MM_DD.test(input)) {
    return input.slice(0, 10);
  }
  const d = input instanceof Date ? input : new Date(input);
  return formatInTimeZone(d, 'America/Hermosillo', 'yyyy-MM-dd');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/common/utils.spec.ts -t toHermosilloDateString`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/utils.ts src/common/utils.spec.ts
git commit -m "feat(expenses): add toHermosilloDateString calendar-day helper"
```

---

### Task 2: Pre-migration data audit (gate)

**Files:**
- Create: `docs/superpowers/plans/audit-expense-dates.sql`

**Interfaces:**
- Produces: evidence confirming the backfill discriminator (`TIME(date) = '06:00:00'` ⇒ legacy Central date-only) is safe. **No code ships in this task.** If the audit shows a material number of real instants at exactly `06:00:00`, STOP and revisit the discriminator with the team before Task 3.

- [ ] **Step 1: Write the audit queries**

```sql
-- docs/superpowers/plans/audit-expense-dates.sql
-- 1) Distribución de la parte de HORA de expense.date.
--    Esperado: la gran mayoría en '06:00:00' (date-only Central) + una cola de instantes variados.
SELECT TIME(`date`) AS time_part, COUNT(*) AS n
FROM `expense`
GROUP BY TIME(`date`)
ORDER BY n DESC
LIMIT 30;

-- 2) Conteo binario: date-only (06:00:00) vs instante real.
SELECT
  SUM(TIME(`date`) = '06:00:00') AS date_only_central,
  SUM(TIME(`date`) <> '06:00:00') AS real_instants,
  COUNT(*) AS total,
  SUM(`date` IS NULL) AS nulls
FROM `expense`;

-- 3) Vista previa de la normalización propuesta (NO modifica nada).
SELECT id, `date` AS old_value, TIME(`date`) AS time_part,
  CASE WHEN TIME(`date`) = '06:00:00' THEN DATE(`date`)
       ELSE DATE(CONVERT_TZ(`date`, '+00:00', '-07:00')) END AS new_day
FROM `expense`
ORDER BY `date` DESC
LIMIT 40;
```

- [ ] **Step 2: Run the audit against the DB**

Run each query (via your MySQL client / the DB console). Confirm:
- Query 2: `real_instants` is a small minority and `nulls = 0`.
- Query 3: `new_day` matches the human-intended day for a spot sample (e.g. the `2026-07-06 06:00:00` fuel rows → `2026-07-06`; the `2026-06-30 22:38:39` row → `2026-06-30`).

Expected: discriminator holds. If not, halt and escalate.

- [ ] **Step 3: Commit the audit script**

```bash
git add docs/superpowers/plans/audit-expense-dates.sql
git commit -m "chore(expenses): add pre-migration date audit queries"
```

---

### Task 3: Migration — normalize + convert column to DATE

**Files:**
- Create: `src/database/migrations/1786000000028-ExpenseDateToCalendarDay.ts`

**Interfaces:**
- Consumes: audit from Task 2 (discriminator confirmed).
- Produces: `expense.date` is now MySQL type `DATE`, `NOT NULL`, values = Hermosillo calendar day. `down()` restores a `DATETIME` column (best-effort, day at Hermosillo midnight = `07:00:00Z`).

- [ ] **Step 1: Write the migration**

```ts
// src/database/migrations/1786000000028-ExpenseDateToCalendarDay.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * expense.date pasa de DATETIME (mezcla de medianoche Central 06:00:00Z y de
 * instantes UTC reales) a DATE (día calendario Hermosillo, sin zona horaria).
 *
 * Backfill (distingue las dos formas históricas):
 *  - TIME(date) = '06:00:00'  => date-only Central: el día ya es DATE(date).
 *  - resto                    => instante real: día = Hermosillo (UTC-7).
 * Se usan offsets numéricos en CONVERT_TZ para no depender de las tz tables.
 */
export class ExpenseDateToCalendarDay1786000000028 implements MigrationInterface {
  name = 'ExpenseDateToCalendarDay1786000000028';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` ADD COLUMN `date_day` DATE NULL');
    await q.query(`
      UPDATE \`expense\`
      SET \`date_day\` = CASE
        WHEN TIME(\`date\`) = '06:00:00' THEN DATE(\`date\`)
        ELSE DATE(CONVERT_TZ(\`date\`, '+00:00', '-07:00'))
      END
    `);
    await q.query('ALTER TABLE `expense` DROP COLUMN `date`');
    await q.query('ALTER TABLE `expense` CHANGE COLUMN `date_day` `date` DATE NOT NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` ADD COLUMN `date_dt` DATETIME NULL');
    // Día calendario Hermosillo -> instante UTC de su medianoche (00:00 -07:00 = 07:00Z).
    await q.query(`
      UPDATE \`expense\`
      SET \`date_dt\` = CONVERT_TZ(CONCAT(\`date\`, ' 00:00:00'), '-07:00', '+00:00')
    `);
    await q.query('ALTER TABLE `expense` DROP COLUMN `date`');
    await q.query('ALTER TABLE `expense` CHANGE COLUMN `date_dt` `date` DATETIME NOT NULL');
  }
}
```

- [ ] **Step 2: Register the migration is discovered**

Run: `npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli migration:show -d src/data-source.ts`
Expected: the list includes `[ ] ExpenseDateToCalendarDay1786000000028` (pending).

- [ ] **Step 3: Run the migration (against a dev/staging DB first)**

Run: `npm run migration:run`
Expected: log shows `ExpenseDateToCalendarDay1786000000028` executed with no error.

- [ ] **Step 4: Verify the column and data**

Run these SQL checks:
```sql
SHOW COLUMNS FROM `expense` LIKE 'date';          -- Type must be 'date'
SELECT id, `date` FROM `expense` ORDER BY `date` DESC LIMIT 10;  -- values are 'YYYY-MM-DD'
SELECT COUNT(*) FROM `expense` WHERE `date` IS NULL;             -- must be 0
```
Expected: `Type = date`; sample rows show plain days; zero nulls. Spot-check that a known `2026-07-06 06:00:00` fuel row is now `2026-07-06`.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/1786000000028-ExpenseDateToCalendarDay.ts
git commit -m "feat(expenses): migrate expense.date datetime -> DATE (Hermosillo calendar day)"
```

---

### Task 4: Entity + write-path coercion

**Files:**
- Modify: `src/entities/expense.entity.ts:35` (column) and `:80-86` (BeforeInsert)
- Modify: `src/expenses/expenses.service.ts:21-24` (create), `:123-134` (Excel import already dateless — verify)
- Test: `src/expenses/expenses.service.spec.ts` (create)

**Interfaces:**
- Consumes: `toHermosilloDateString` (Task 1).
- Produces: `Expense.date` is typed `string`. `ExpensesService.create` always persists `date` as a `'YYYY-MM-DD'` day.

- [ ] **Step 1: Write the failing test**

```ts
// src/expenses/expenses.service.spec.ts
import { ExpensesService } from './expenses.service';

describe('ExpensesService.create date coercion', () => {
  const makeService = () => {
    const saved: any[] = [];
    const repo: any = {
      create: (dto: any) => dto,
      save: (e: any) => { saved.push(e); return Promise.resolve(e); },
    };
    const service = new ExpensesService(repo, {} as any, {} as any);
    return { service, saved };
  };

  it('stores the picked wall-clock day when front sends Central-anchored ISO', async () => {
    const { service, saved } = makeService();
    await service.create({ date: '2026-07-06T06:00:00.000Z', amount: 100 } as any);
    expect(saved[0].date).toBe('2026-07-06');
  });

  it('defaults a missing date to today in Hermosillo', async () => {
    const { service, saved } = makeService();
    await service.create({ amount: 50 } as any);
    expect(saved[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/expenses/expenses.service.spec.ts`
Expected: FAIL — first test gets `'2026-07-06T06:00:00.000Z'` (uncoerced).

- [ ] **Step 3: Update the entity**

In `src/entities/expense.entity.ts`, change the column and the hook:

```ts
// import at top
import { toHermosilloDateString } from 'src/common/utils';

// replace the date column (was: @Column({ type: 'datetime' }) date: Date;)
@Column({ type: 'date' })
date: string;
```

```ts
// replace setCreatedAt() body
@BeforeInsert()
setCreatedAt() {
  this.createdAt = new Date(); // instante UTC (createdAt sigue siendo datetime)
  if (!this.date) {
    this.date = toHermosilloDateString(new Date()); // día calendario Hermosillo
  }
}
```

- [ ] **Step 4: Coerce in the service create()**

In `src/expenses/expenses.service.ts`, add the import and coerce before save:

```ts
import { toHermosilloDateString } from 'src/common/utils';
// ...
async create(createExpenseDto: Expense) {
  if (createExpenseDto.date) {
    createExpenseDto.date = toHermosilloDateString(createExpenseDto.date);
  }
  const newExpense = this.expenseRepository.create(createExpenseDto);
  return await this.expenseRepository.save(newExpense);
}
```

Verify `importFromExcel` (line ~123) does **not** set `date` — the BeforeInsert hook now assigns today's Hermosillo day. No change needed there.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/expenses/expenses.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck the ripple from `Date` → `string`**

Run: `npx tsc --noEmit`
Expected: errors ONLY at the known consumers fixed in Tasks 5-8 (notably `src/income/income.service.ts` `g.date.toISOString()`). Note them; they are addressed next.

- [ ] **Step 7: Commit**

```bash
git add src/entities/expense.entity.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts
git commit -m "feat(expenses): store expense.date as Hermosillo calendar day on write"
```

---

### Task 5: Fix the dashboard expense query (the reported bug)

**Files:**
- Modify: `src/dashboard/kpi.service.ts:433` (active method `getSubsidiariesKpis`)
- Modify: `src/dashboard/kpi.service.ts:231` (dead method `getSubsidiariesKpisResp0205` — keep consistent to avoid a latent trap)

**Interfaces:**
- Consumes: `baseStartDate`, `baseEndDate` (already computed as `'YYYY-MM-DD'` in both methods).
- Produces: expense aggregation filters on date-only bounds, so a day-X expense counts on day X.

- [ ] **Step 1: Change the active expense query bounds**

In `getSubsidiariesKpis` (~line 428-437), replace the expense query's `.where(...)`:

```ts
// -- C. ESTADÍSTICAS DE GASTOS --
this.expenseRepository.createQueryBuilder('expense')
  .select('expense.subsidiaryId', 'subsidiaryId')
  .addSelect('expense.frequency', 'frequency')
  .addSelect('SUM(expense.amount)', 'totalAmount')
  .addSelect('COUNT(expense.id)', 'txCount')
  // expense.date es DATE (día calendario). Comparamos día contra día, sin TZ.
  .where('expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate })
  .andWhere(subsidiaryCondition, { subsidiaryIds })
  .groupBy('expense.subsidiaryId')
  .addGroupBy('expense.frequency')
  .getRawMany(),
```

- [ ] **Step 2: Apply the identical change in the dead method**

In `getSubsidiariesKpisResp0205` (~line 226-235) make the same `.where('expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate })` edit, so the stale copy can't reintroduce the bug if ever wired up.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `kpi.service.ts`.

- [ ] **Step 4: Manual verification against real data**

Start the API (`npm run start:dev`) and call the endpoint for a subsidiary+range that you know has expenses (e.g. subsidiary `2aae6b77-d5e5-422e-8324-d4126f8c0298`, `startDate=2026-07-01&endDate=2026-07-31`).
Expected: `totalExpenses > 0` and it includes the `2026-07-01` and `2026-07-06` fuel rows that previously fell outside the window. Confirm the July-1 expense is no longer missing.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/kpi.service.ts
git commit -m "fix(dashboard): count expenses by calendar day (date-only bounds)"
```

---

### Task 6: Fix income getTotalExpenses (forced by `Date`→`string`)

**Files:**
- Modify: `src/income/income.service.ts:73-97`

**Interfaces:**
- Consumes: `fromDate`, `toDate` (Date objects from the caller).
- Produces: expense fetch uses date-only bounds; day grouping reads the string date directly (no `.toISOString()` on a string).

- [ ] **Step 1: Convert bounds to day strings and fix grouping**

Replace the query + grouping in `getTotalExpenses`:

```ts
import { toHermosilloDateString } from 'src/common/utils';
// ...
// 1) Traer todos los gastos en el rango (expense.date es DATE => comparamos por día)
const startDay = toHermosilloDateString(fromDate);
const endDay = toHermosilloDateString(toDate);
const expenses = await this.expenseRepository.find({
  where: {
    subsidiary: { id: subsidiaryId },
    date: Between(startDay, endDay),
  },
  order: { date: 'ASC' },
});
```

```ts
// 3) Agrupar por día — g.date YA es 'YYYY-MM-DD'
const grouped: Record<string, Expense[]> = {};
expenses.forEach((g) => {
  const dayKey = g.date; // string 'YYYY-MM-DD'
  if (!grouped[dayKey]) grouped[dayKey] = [];
  grouped[dayKey].push(g);
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: the previous `g.date.toISOString()` error in `income.service.ts` is gone; no new errors here.

- [ ] **Step 3: Commit**

```bash
git add src/income/income.service.ts
git commit -m "fix(income): read expense.date as calendar-day string with date-only bounds"
```

---

### Task 7: Fix the income-statement report expense window

**Files:**
- Modify: `src/resports/resports.service.ts:58-62` (query bounds) and `:90-96` (day grouping)

**Interfaces:**
- Consumes: `baseStartDate`, `baseEndDate` (already `'YYYY-MM-DD'` at lines 25-26).
- Produces: EGRESOS section includes boundary-day expenses; grouping keys off the calendar-day string.

- [ ] **Step 1: Change the expense query to date-only bounds**

Replace the `allExpenses` query (line 58-62):

```ts
const allExpenses = await this.expenseRepository
  .createQueryBuilder('expense')
  .where(expenseSubsidiaryCondition, { subsidiaryIds })
  // expense.date es DATE (día calendario); usamos límites de día.
  .andWhere('expense.date >= :startDay AND expense.date <= :endDay', { startDay: baseStartDate, endDay: baseEndDate })
  .getMany();
```

- [ ] **Step 2: Simplify the day-key derivation**

Replace line ~92 (`const dStr = new Date(exp.date).toISOString().split('T')[0];`) with the direct string:

```ts
const dStr = String(exp.date).slice(0, 10); // exp.date ya es 'YYYY-MM-DD'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `resports.service.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/resports/resports.service.ts
git commit -m "fix(reports): expense EGRESOS uses calendar-day bounds and keys"
```

---

### Task 8: Fix findBySubsidiaryAndDates + controller parsing

**Files:**
- Modify: `src/expenses/expenses.service.ts:50-59` (`findBySubsidiaryAndDates`)
- Modify: `src/expenses/expenses.controller.ts:42-51` (`getExpensesBySucursalAndDates`)

**Interfaces:**
- Consumes: `toHermosilloDateString` (Task 1); query params `firstDay`, `lastDay`.
- Produces: date-range lookup compares day strings against the `DATE` column.

- [ ] **Step 1: Accept day strings in the service**

Replace `findBySubsidiaryAndDates`:

```ts
async findBySubsidiaryAndDates(subsidiaryId: string, firstDay: string, lastDay: string) {
  return await this.expenseRepository.find({
    where: {
      subsidiary: { id: subsidiaryId },
      date: Between(firstDay, lastDay), // 'YYYY-MM-DD' contra columna DATE
    },
  });
}
```

- [ ] **Step 2: Pass day strings from the controller**

Replace `getExpensesBySucursalAndDates` body (drop the `new Date(...)` conversions):

```ts
@Get('findBySubsidiaryAndDates')
getExpensesBySucursalAndDates(
  @Query('subsidiaryId') subsidiaryId: string,
  @Query('firstDay') firstDay: string,
  @Query('lastDay') lastDay: string
) {
  return this.expensesService.findBySubsidiaryAndDates(
    subsidiaryId,
    firstDay.slice(0, 10),
    lastDay.slice(0, 10),
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (0 errors) across the project.

- [ ] **Step 4: Commit**

```bash
git add src/expenses/expenses.service.ts src/expenses/expenses.controller.ts
git commit -m "fix(expenses): date-range lookup uses calendar-day strings"
```

---

### Task 9: Full verification & regression sweep

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS, including `utils.spec.ts` and `expenses.service.spec.ts`; no previously-passing suite regressed.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: End-to-end dashboard check**

With `npm run start:dev` and a real token:
- Call `/dashboard/subsidiary-metrics?startDate=2026-07-01&endDate=2026-07-31&subsidiaryIds=2aae6b77-d5e5-422e-8324-d4126f8c0298`.
- Confirm `totalExpenses` equals the SQL truth:
  ```sql
  SELECT SUM(amount) FROM expense
  WHERE subsidiaryId = '2aae6b77-d5e5-422e-8324-d4126f8c0298'
    AND `date` BETWEEN '2026-07-01' AND '2026-07-31';
  ```
  (Note: dashboard prorates non-UNIQUE/DIARIO frequencies, so compare per-frequency if amounts differ — the raw SUM is the upper bound and the July-1/July-6 rows must now be inside it.)

- [ ] **Step 4: Confirm the boundary bug is gone**

Query the single day: `startDate=2026-07-06&endDate=2026-07-06`. Expected: the three `2026-07-06` fuel expenses appear (previously they landed on 2026-07-05).

- [ ] **Step 5: Frontend follow-up note (out of repo)**

Record for the web team: the expense form should send `date` as a plain `YYYY-MM-DD` (no time/offset). The backend now tolerates offset-bearing ISO strings by taking the wall-clock day, but plain days are the contract going forward.

---

## Notes / Out of Scope

- **Frontend change** (expense datepicker sending `YYYY-MM-DD`) is required for full cleanliness but lives in the web repo; the backend coercion in Task 4 makes the fix safe without it.
- **FedEx `processMasterFedexUpdate` non-updates** are a separate investigation, intentionally excluded here.
- The dead method `getSubsidiariesKpisResp0205` is patched (Task 5) but not otherwise resurrected; consider deleting it in a later cleanup.
