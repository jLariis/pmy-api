# Expense Categories Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ExpenseCategory` enum with normalized `expense_category` + `expense_category_group` tables (FK from `expense`), migrate the ~2,322 existing expenses deterministically, and expose CRUD so categories and groups are user-manageable — legacy values kept as system, the new list added as editable.

**Architecture:** Two new tables. `expense.category` (enum) → `expense.categoryId` FK. Legacy 11 enum values seeded as `isSystem=true` (protect history); the new grouped list seeded as `isSystem=false`. A single migration creates tables, seeds, adds the FK, backfills via an explicit identity map of the 11 legacy strings (names kept verbatim), gates on zero-unmapped, then drops the old column. `expense_category` is deregistered from the generic catalog so there is one source of truth. A new `expense-categories` module provides category + group CRUD reusing the catalog's proven system/in-use delete rules.

**Tech Stack:** NestJS, TypeORM (MySQL, connection `timezone: "Z"`, entities auto-loaded via `entities/*.entity.{js,ts}` glob), Jest, raw SQL migration.

## Global Constraints

- **Names kept verbatim** — legacy category names are NOT renamed. The only new-list label that differed by casing ("Otros Gastos") collapses into the legacy "Otros gastos" (single system row). All other overlaps already match exactly.
- Legacy 11 (`Nómina, Renta, Recarga, Peajes, Servicios, Combustible, Otros gastos, Mantenimiento, Impuestos, Seguros, Viáticos`) = `isSystem=true`. New-only = `isSystem=false`. Overlaps = single `isSystem=true` row.
- Delete rules: `isSystem=true` cannot be deleted; user rows deletable only when not referenced by any expense; a group is deletable only when `isSystem=false` and has no categories.
- Migration number **`1786000000030`** (…029 is claimed by the unmerged `feat/expense-proration-by-period` branch).
- Backfill must end with **zero** expenses that had a non-empty legacy `category` but a NULL `categoryId` (verify-gate aborts otherwise) before the old column is dropped.
- Only expense-category concerns change. Do not alter income/shipment/charge/consolidated logic.
- The full seed (groups + categories + isSystem flags + group placement) is in the design spec §4: `docs/superpowers/specs/2026-07-09-expense-categories-redesign-design.md`. Use it verbatim.

---

### Task 1: Entities — group, category, and Expense FK

**Files:**
- Create: `src/entities/expense-category-group.entity.ts`
- Rewrite: `src/entities/expense-category.entity.ts`
- Modify: `src/entities/expense.entity.ts` (replace enum `category` column with a relation)
- Modify: `src/entities/index.ts` (export the two category entities)

**Interfaces:**
- Produces: `ExpenseCategoryGroup` (table `expense_category_group`: `id,name,icon?,sortOrder,isSystem,active,createdAt`, `@OneToMany categories`); `ExpenseCategory` entity (table `expense_category`: `id,name,groupId?,isSystem,active,sortOrder,description?,createdAt`, `@ManyToOne group`, `@OneToMany expenses`); `Expense.category?: ExpenseCategory` + `Expense.categoryId?: string`.

- [ ] **Step 1: Create the group entity**

```ts
// src/entities/expense-category-group.entity.ts
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ExpenseCategory } from './expense-category.entity';

@Entity('expense_category_group')
export class ExpenseCategoryGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  icon?: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: false })
  isSystem: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => ExpenseCategory, (c) => c.group)
  categories: ExpenseCategory[];
}
```

- [ ] **Step 2: Rewrite the category entity**

```ts
// src/entities/expense-category.entity.ts
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Expense } from './expense.entity';
import { ExpenseCategoryGroup } from './expense-category-group.entity';

@Entity('expense_category')
export class ExpenseCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => ExpenseCategoryGroup, (g) => g.categories, { nullable: true })
  @JoinColumn({ name: 'groupId' })
  group?: ExpenseCategoryGroup;

  @Column({ nullable: true })
  groupId?: string;

  @Column({ default: false })
  isSystem: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Expense, (e) => e.category)
  expenses: Expense[];
}
```

- [ ] **Step 3: Change the Expense category column to a relation**

In `src/entities/expense.entity.ts`: remove `import { ExpenseCategory } from '../common/enums/category-enum';` and the enum `category` column (the `@Column({ type: 'enum', enum: ExpenseCategory, nullable: true }) category?: ExpenseCategory;` block). Add:

```ts
// near the other imports
import { ExpenseCategory } from './expense-category.entity';
```
```ts
// replacing the old enum category column
@ManyToOne(() => ExpenseCategory, { nullable: true })
@JoinColumn({ name: 'categoryId' })
category?: ExpenseCategory;

@Column({ nullable: true })
categoryId?: string;
```
(`JoinColumn` / `ManyToOne` are already imported in this entity.)

- [ ] **Step 4: Export the entities**

In `src/entities/index.ts` add (near the other exports):
```ts
export * from './expense-category-group.entity';
export * from './expense-category.entity';
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in the known consumers that still use the enum (`src/expenses/expenses.service.ts` line ~142 `category: ExpenseCategory.Combustible`, `src/resports/resports.service.ts` pivot on `exp.category`, and `src/catalog/catalog-definition.ts` importing the enum) plus the 2 pre-existing `src/auth/*.spec.ts` errors. These consumers are fixed in Tasks 3 & 5. There must be NO error inside the three entity files. List the remaining errors in your report.

- [ ] **Step 6: Commit**

```bash
git add src/entities/expense-category-group.entity.ts src/entities/expense-category.entity.ts src/entities/expense.entity.ts src/entities/index.ts
git commit -m "feat(expenses): add expense_category + group entities, Expense.category FK"
```

---

### Task 2: Migration — tables, seed, FK, backfill, drop enum column

**Files:**
- Create: `src/database/migrations/1786000000030-ExpenseCategoriesRedesign.ts`
- Create: `docs/superpowers/plans/audit-expense-categories.sql`

**Interfaces:**
- Consumes: the seed table from spec §4.
- Produces: `expense_category_group` + `expense_category` populated; `expense.categoryId` FK populated for all legacy rows; old `expense.category` column dropped.

- [ ] **Step 1: Write the pre-migration audit**

```sql
-- docs/superpowers/plans/audit-expense-categories.sql
-- Confirm every DISTINCT legacy category value is one of the 11 mapped strings.
-- Any row here NOT in the map => reconcile before running the migration.
SELECT `category` AS legacy_value, COUNT(*) AS n
FROM `expense`
GROUP BY `category`
ORDER BY n DESC;

-- Guard: is there already a physical `expense_category` table? (orphan entity never had a migration)
SHOW TABLES LIKE 'expense_category';
-- If it exists and is non-empty, stop and decide; the migration below assumes it does not exist.
```

- [ ] **Step 2: Write the migration**

```ts
// src/database/migrations/1786000000030-ExpenseCategoriesRedesign.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * expense.category (enum) -> FK a expense_category (tabla normalizada), con grupos.
 * Las 11 viejas = isSystem=true (protegen datos históricos); la lista nueva = editable.
 * Nombres verbatim (no rename). Backfill determinista por mapa identidad de las 11.
 */
export class ExpenseCategoriesRedesign1786000000030 implements MigrationInterface {
  name = 'ExpenseCategoriesRedesign1786000000030';

  public async up(q: QueryRunner): Promise<void> {
    // 1) Tablas
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`expense_category_group\` (
        \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL,
        \`icon\` VARCHAR(16) NULL,
        \`sortOrder\` INT NOT NULL DEFAULT 0,
        \`isSystem\` TINYINT NOT NULL DEFAULT 0,
        \`active\` TINYINT NOT NULL DEFAULT 1,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`expense_category\` (
        \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL,
        \`groupId\` VARCHAR(36) NULL,
        \`isSystem\` TINYINT NOT NULL DEFAULT 0,
        \`active\` TINYINT NOT NULL DEFAULT 1,
        \`sortOrder\` INT NOT NULL DEFAULT 0,
        \`description\` VARCHAR(255) NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY \`idx_ec_group\` (\`groupId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2) Seed grupos (isSystem=1)
    const groups: Array<{ name: string; icon: string }> = [
      { name: 'Personal y Nómina', icon: '👥' },
      { name: 'Instalaciones y Servicios', icon: '🏢' },
      { name: 'Vehículos y Operación', icon: '🚚' },
      { name: 'Viajes y Distribución', icon: '🛣️' },
      { name: 'Administrativos y Otros', icon: '📦' },
    ];
    const groupId: Record<string, string> = {};
    for (let i = 0; i < groups.length; i++) {
      const id = randomUUID();
      groupId[groups[i].name] = id;
      await q.query(
        'INSERT INTO `expense_category_group` (`id`,`name`,`icon`,`sortOrder`,`isSystem`,`active`) VALUES (?,?,?,?,1,1)',
        [id, groups[i].name, groups[i].icon, i + 1],
      );
    }

    // 3) Seed categorías. system=true para las 11 viejas (y overlaps); false para nuevas.
    //    [name, groupName, isSystem]
    const cats: Array<[string, string, number]> = [
      ['Nómina', 'Personal y Nómina', 1],
      ['Carga Social', 'Personal y Nómina', 0],
      ['Comisiones', 'Personal y Nómina', 0],
      ['Vacaciones', 'Personal y Nómina', 0],
      ['Finiquitos / Liquidaciones', 'Personal y Nómina', 0],
      ['Despensa', 'Personal y Nómina', 0],
      ['Equipo de Seguridad', 'Personal y Nómina', 0],
      ['Renta', 'Instalaciones y Servicios', 1],
      ['Renta de Oficina', 'Instalaciones y Servicios', 0],
      ['Renta de Bodega', 'Instalaciones y Servicios', 0],
      ['Renta de Local', 'Instalaciones y Servicios', 0],
      ['Renta Habitacional', 'Instalaciones y Servicios', 0],
      ['Internet', 'Instalaciones y Servicios', 0],
      ['Agua', 'Instalaciones y Servicios', 0],
      ['Luz', 'Instalaciones y Servicios', 0],
      ['Servicios', 'Instalaciones y Servicios', 1],
      ['Papelería', 'Instalaciones y Servicios', 0],
      ['Artículos de Limpieza', 'Instalaciones y Servicios', 0],
      ['Combustible', 'Vehículos y Operación', 1],
      ['Mantenimiento', 'Vehículos y Operación', 1],
      ['Mantenimiento de Bodega', 'Vehículos y Operación', 0],
      ['Póliza de Seguro', 'Vehículos y Operación', 0],
      ['Seguros', 'Vehículos y Operación', 1],
      ['Revalidación de Unidades', 'Vehículos y Operación', 0],
      ['Arrendamiento', 'Vehículos y Operación', 0],
      ['Financiamiento', 'Vehículos y Operación', 0],
      ['Permisos', 'Vehículos y Operación', 0],
      ['Permisos de Carga y Descarga', 'Vehículos y Operación', 0],
      ['Recargas LEO', 'Vehículos y Operación', 0],
      ['Recargas GPS', 'Vehículos y Operación', 0],
      ['Saldos LEO y GPS', 'Vehículos y Operación', 0],
      ['Recarga', 'Vehículos y Operación', 1],
      ['Viáticos', 'Viajes y Distribución', 1],
      ['Viáticos de Alimentación', 'Viajes y Distribución', 0],
      ['Comida Ruta Local', 'Viajes y Distribución', 0],
      ['Peajes', 'Viajes y Distribución', 1],
      ['Traslados', 'Viajes y Distribución', 0],
      ['Vuelos', 'Viajes y Distribución', 0],
      ['Apoyo Carga y Descarga', 'Viajes y Distribución', 0],
      ['Servicios de Mensajería', 'Administrativos y Otros', 0],
      ['Otros gastos', 'Administrativos y Otros', 1],
      ['Impuestos', 'Administrativos y Otros', 1],
    ];
    const catId: Record<string, string> = {};
    for (let i = 0; i < cats.length; i++) {
      const [name, gName, isSystem] = cats[i];
      const id = randomUUID();
      catId[name] = id;
      await q.query(
        'INSERT INTO `expense_category` (`id`,`name`,`groupId`,`isSystem`,`active`,`sortOrder`) VALUES (?,?,?,?,1,?)',
        [id, name, groupId[gName], isSystem, i],
      );
    }

    // 4) FK en expense
    await q.query('ALTER TABLE `expense` ADD COLUMN `categoryId` VARCHAR(36) NULL');

    // 5) Backfill: mapa identidad de las 11 (nombres verbatim)
    const legacyMap: Record<string, string> = {
      'Nómina': 'Nómina',
      'Renta': 'Renta',
      'Recarga': 'Recarga',
      'Peajes': 'Peajes',
      'Servicios': 'Servicios',
      'Combustible': 'Combustible',
      'Otros gastos': 'Otros gastos',
      'Mantenimiento': 'Mantenimiento',
      'Impuestos': 'Impuestos',
      'Seguros': 'Seguros',
      'Viáticos': 'Viáticos',
    };
    for (const legacy of Object.keys(legacyMap)) {
      const targetId = catId[legacyMap[legacy]];
      await q.query('UPDATE `expense` SET `categoryId` = ? WHERE `category` = ?', [targetId, legacy]);
    }

    // 6) Verify-gate: cero gastos con category no vacío sin mapear
    const unmapped = await q.query(
      "SELECT COUNT(*) AS c FROM `expense` WHERE `category` IS NOT NULL AND `category` <> '' AND `categoryId` IS NULL",
    );
    const c = Number(unmapped?.[0]?.c ?? 0);
    if (c > 0) {
      throw new Error(`Migración abortada: ${c} gastos con categoría legacy sin mapear. Revisar audit-expense-categories.sql.`);
    }

    // 7) FK + drop columna vieja
    await q.query('ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_category` FOREIGN KEY (`categoryId`) REFERENCES `expense_category`(`id`) ON DELETE RESTRICT');
    await q.query('ALTER TABLE `expense` DROP COLUMN `category`');
  }

  public async down(q: QueryRunner): Promise<void> {
    // Reponer columna enum-equivalente como VARCHAR y rellenar desde el nombre de la categoría.
    await q.query('ALTER TABLE `expense` ADD COLUMN `category` VARCHAR(255) NULL');
    await q.query('UPDATE `expense` e JOIN `expense_category` c ON c.`id` = e.`categoryId` SET e.`category` = c.`name`');
    await q.query('ALTER TABLE `expense` DROP FOREIGN KEY `fk_expense_category`');
    await q.query('ALTER TABLE `expense` DROP COLUMN `categoryId`');
    await q.query('DROP TABLE IF EXISTS `expense_category`');
    await q.query('DROP TABLE IF EXISTS `expense_category_group`');
  }
}
```

- [ ] **Step 3: Typecheck the migration**

Run: `npx tsc --noEmit`
Expected: no error inside the migration file (consumer errors from Task 1 may still be present until Tasks 3 & 5). Note the migration file itself is clean.

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/1786000000030-ExpenseCategoriesRedesign.ts docs/superpowers/plans/audit-expense-categories.sql
git commit -m "feat(expenses): migration — expense_category tables, seed, FK backfill, drop enum column"
```

> `npm run migration:run` and the audit are DEFERRED to the user (no DB here). The migration self-aborts if any legacy value is unmapped before dropping the old column.

---

### Task 3: Deregister expense_category from the generic catalog

**Files:**
- Modify: `src/catalog/catalog-definition.ts`

**Interfaces:**
- Produces: `expense_category` no longer appears in `CATALOG_DEFS` or `CATALOG_USAGE`; the `ExpenseCategory` enum import is dropped from this file.

- [ ] **Step 1: Remove the CATALOG_DEFS entry**

Delete this line from the `CATALOG_DEFS` array:
```ts
{ type: 'expense_category', label: 'Categoría de gasto', enumObj: ExpenseCategory as any },
```

- [ ] **Step 2: Remove the CATALOG_USAGE entry**

Delete this line from `CATALOG_USAGE`:
```ts
expense_category: [{ table: 'expense', column: 'category' }],
```

- [ ] **Step 3: Drop the now-unused enum import**

In the top `import { ... } from 'src/common/enums';` remove `ExpenseCategory,` from the import list (it is no longer referenced in this file). Leave the other enums.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no error in `catalog-definition.ts`. Remaining errors confined to `expenses.service.ts` / `resports.service.ts` (fixed in Task 5) + the 2 pre-existing auth errors.

- [ ] **Step 5: Commit**

```bash
git add src/catalog/catalog-definition.ts
git commit -m "refactor(catalog): deregister expense_category (moved to dedicated table)"
```

---

### Task 4: expense-categories CRUD module

**Files:**
- Create: `src/expense-categories/dto/expense-category.dto.ts`
- Create: `src/expense-categories/expense-categories.service.ts`
- Create: `src/expense-categories/expense-categories.controller.ts`
- Create: `src/expense-categories/expense-categories.module.ts`
- Test: `src/expense-categories/expense-categories.service.spec.ts`
- Modify: `src/app.module.ts` (register the module)

**Interfaces:**
- Consumes: `ExpenseCategory`, `ExpenseCategoryGroup` entities.
- Produces: `ExpenseCategoriesService` with `getGrouped()`, `createCategory`, `updateCategory`, `removeCategory`, `listGroups`, `createGroup`, `updateGroup`, `removeGroup`. Delete guards mirror the catalog (system-protected; in-use blocked).

- [ ] **Step 1: Write the DTOs**

```ts
// src/expense-categories/dto/expense-category.dto.ts
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString() name: string;
  @IsString() @IsOptional() groupId?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsString() @IsOptional() description?: string;
}

export class UpdateExpenseCategoryDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() groupId?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsBoolean() @IsOptional() active?: boolean;
  @IsString() @IsOptional() description?: string;
}

export class CreateExpenseGroupDto {
  @IsString() name: string;
  @IsString() @IsOptional() icon?: string;
  @IsInt() @IsOptional() sortOrder?: number;
}

export class UpdateExpenseGroupDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() icon?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsBoolean() @IsOptional() active?: boolean;
}
```

- [ ] **Step 2: Write the failing service test**

```ts
// src/expense-categories/expense-categories.service.spec.ts
import { ExpenseCategoriesService } from './expense-categories.service';

function makeService(overrides: any = {}) {
  const catRepo: any = {
    create: (d: any) => d,
    save: (e: any) => Promise.resolve({ id: 'c1', ...e }),
    findOne: overrides.catFindOne ?? (() => Promise.resolve(null)),
    remove: jest.fn(() => Promise.resolve()),
    find: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
  };
  const groupRepo: any = {
    create: (d: any) => d,
    save: (e: any) => Promise.resolve({ id: 'g1', ...e }),
    findOne: () => Promise.resolve(null),
    remove: jest.fn(() => Promise.resolve()),
    find: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
  };
  // The in-use check for a category counts EXPENSES referencing it.
  const expenseRepo: any = { count: overrides.inUseCount ?? (() => Promise.resolve(0)) };
  const svc = new ExpenseCategoriesService(catRepo, groupRepo, expenseRepo);
  return { svc, catRepo, groupRepo, expenseRepo };
}

describe('ExpenseCategoriesService', () => {
  it('create forces isSystem=false', async () => {
    const { svc } = makeService();
    const created = await svc.createCategory({ name: 'Nueva' } as any);
    expect(created.isSystem).toBe(false);
  });

  it('cannot delete a system category', async () => {
    const { svc } = makeService({ catFindOne: () => Promise.resolve({ id: 'c1', isSystem: true }) });
    await expect(svc.removeCategory('c1')).rejects.toThrow();
  });

  it('cannot delete a user category that is in use', async () => {
    const { svc } = makeService({
      catFindOne: () => Promise.resolve({ id: 'c1', isSystem: false }),
      inUseCount: () => Promise.resolve(3),
    });
    await expect(svc.removeCategory('c1')).rejects.toThrow();
  });

  it('deletes an unused user category', async () => {
    const { svc, catRepo } = makeService({
      catFindOne: () => Promise.resolve({ id: 'c1', isSystem: false }),
      inUseCount: () => Promise.resolve(0),
    });
    await svc.removeCategory('c1');
    expect(catRepo.remove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/expense-categories/expense-categories.service.spec.ts`
Expected: FAIL — module/service does not exist yet.

- [ ] **Step 4: Write the service**

```ts
// src/expense-categories/expense-categories.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense, ExpenseCategory, ExpenseCategoryGroup } from 'src/entities';
import {
  CreateExpenseCategoryDto, UpdateExpenseCategoryDto,
  CreateExpenseGroupDto, UpdateExpenseGroupDto,
} from './dto/expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectRepository(ExpenseCategory) private readonly catRepo: Repository<ExpenseCategory>,
    @InjectRepository(ExpenseCategoryGroup) private readonly groupRepo: Repository<ExpenseCategoryGroup>,
    @InjectRepository(Expense) private readonly expenseRepo: Repository<Expense>,
  ) {}

  /** Payload agrupado para el formulario de gastos. */
  async getGrouped(includeInactive = false) {
    const groups = await this.groupRepo.find({ order: { sortOrder: 'ASC' } });
    const cats = await this.catRepo.find({ order: { sortOrder: 'ASC' } });
    const visible = (x: { active: boolean }) => includeInactive || x.active;
    return groups.filter(visible).map((g) => ({
      group: { id: g.id, name: g.name, icon: g.icon, sortOrder: g.sortOrder, isSystem: g.isSystem, active: g.active },
      categories: cats
        .filter((c) => c.groupId === g.id && visible(c))
        .map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, isSystem: c.isSystem, active: c.active })),
    }));
  }

  // --- Categorías ---
  async createCategory(dto: CreateExpenseCategoryDto) {
    const item = this.catRepo.create({
      name: dto.name,
      groupId: dto.groupId,
      sortOrder: dto.sortOrder ?? 0,
      description: dto.description,
      isSystem: false,
      active: true,
    });
    return this.catRepo.save(item);
  }

  async updateCategory(id: string, dto: UpdateExpenseCategoryDto) {
    const item = await this.catRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Categoría no encontrada.');
    if (dto.name !== undefined) item.name = dto.name;
    if (dto.groupId !== undefined) item.groupId = dto.groupId;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) item.active = dto.active;
    if (dto.description !== undefined) item.description = dto.description;
    return this.catRepo.save(item);
  }

  async removeCategory(id: string) {
    const item = await this.catRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Categoría no encontrada.');
    if (item.isSystem) {
      throw new ConflictException('Es una categoría del sistema: no se puede eliminar. Puedes desactivarla.');
    }
    const inUse = await this.expenseRepo.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw new ConflictException(`No se puede eliminar: ${inUse} gasto(s) usan esta categoría. Desactívala en su lugar.`);
    }
    await this.catRepo.remove(item);
    return { deleted: true };
  }

  // --- Grupos ---
  listGroups() {
    return this.groupRepo.find({ order: { sortOrder: 'ASC' } });
  }

  async createGroup(dto: CreateExpenseGroupDto) {
    const g = this.groupRepo.create({
      name: dto.name, icon: dto.icon, sortOrder: dto.sortOrder ?? 0, isSystem: false, active: true,
    });
    return this.groupRepo.save(g);
  }

  async updateGroup(id: string, dto: UpdateExpenseGroupDto) {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException('Grupo no encontrado.');
    if (dto.name !== undefined) g.name = dto.name;
    if (dto.icon !== undefined) g.icon = dto.icon;
    if (dto.sortOrder !== undefined) g.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) g.active = dto.active;
    return this.groupRepo.save(g);
  }

  async removeGroup(id: string) {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException('Grupo no encontrado.');
    if (g.isSystem) {
      throw new ConflictException('Es un grupo del sistema: no se puede eliminar. Puedes desactivarlo.');
    }
    const count = await this.catRepo.count({ where: { groupId: id } });
    if (count > 0) {
      throw new ConflictException(`No se puede eliminar: el grupo tiene ${count} categoría(s). Reasígnalas primero.`);
    }
    await this.groupRepo.remove(g);
    return { deleted: true };
  }
}
```

Note: the in-use check counts EXPENSES referencing the category via the injected `expenseRepo` (the spec's `makeService` maps `overrides.inUseCount` to that repo's `count`), NOT categories.

- [ ] **Step 5: Write the controller**

```ts
// src/expense-categories/expense-categories.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  CreateExpenseCategoryDto, UpdateExpenseCategoryDto,
  CreateExpenseGroupDto, UpdateExpenseGroupDto,
} from './dto/expense-category.dto';

@ApiTags('expense-categories')
@ApiBearerAuth()
@Controller('expense-categories')
@UseGuards(JwtAuthGuard)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  getGrouped(@Query('includeInactive') includeInactive?: string) {
    return this.service.getGrouped(includeInactive === 'true');
  }

  @Post()
  createCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Patch(':id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete(':id')
  removeCategory(@Param('id') id: string) {
    return this.service.removeCategory(id);
  }

  @Get('groups/all')
  listGroups() {
    return this.service.listGroups();
  }

  @Post('groups')
  createGroup(@Body() dto: CreateExpenseGroupDto) {
    return this.service.createGroup(dto);
  }

  @Patch('groups/:id')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateExpenseGroupDto) {
    return this.service.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  removeGroup(@Param('id') id: string) {
    return this.service.removeGroup(id);
  }
}
```

(Route order: `groups/all`, `groups`, `groups/:id` are declared so the static `groups` segment cannot be shadowed by `:id`. `@Delete(':id')` only matches a bare id, not `groups/:id`, because Nest matches the more specific route — keep the group routes prefixed with `groups/`.)

- [ ] **Step 6: Write the module and register it**

```ts
// src/expense-categories/expense-categories.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense, ExpenseCategory, ExpenseCategoryGroup } from 'src/entities';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseCategoriesController } from './expense-categories.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExpenseCategory, ExpenseCategoryGroup, Expense])],
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService],
  exports: [ExpenseCategoriesService],
})
export class ExpenseCategoriesModule {}
```

In `src/app.module.ts`, add `ExpenseCategoriesModule` to the `imports` array (next to `ExpensesModule`), with the matching import statement `import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module';`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest src/expense-categories/expense-categories.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/expense-categories src/app.module.ts
git commit -m "feat(expense-categories): CRUD module for categories and groups"
```

---

### Task 5: Update consumers (Expense write + report)

**Files:**
- Modify: `src/expenses/expenses.service.ts` (Excel import sets `categoryId`; drop enum import)
- Modify: `src/resports/resports.service.ts` (load category relation; pivot by `category.name`)

**Interfaces:**
- Consumes: `ExpenseCategory` entity; `Expense.categoryId`.

- [ ] **Step 1: Fix the Excel import in expenses.service**

In `src/expenses/expenses.service.ts`:
- Remove `import { ExpenseCategory } from 'src/common/enums/category-enum';`.
- Inject the category repo: add `@InjectRepository(ExpenseCategory) private categoryRepo: Repository<ExpenseCategory>` (import the ENTITY `ExpenseCategory` from `src/entities`) to the constructor, and register it in `ExpensesModule`'s `forFeature`.
- In `importFromExcel`, before building rows, resolve the Combustible category id once:
  ```ts
  const combustible = await this.categoryRepo.findOne({ where: { name: 'Combustible' } });
  ```
  and in each created expense replace `category: ExpenseCategory.Combustible,` with `categoryId: combustible?.id ?? null,`.
- `create(createExpenseDto: Expense)` already passes through `categoryId` on the entity; no change beyond it compiling (the manual create path receives `categoryId` from the client body).

Add `ExpenseCategory` to `ExpensesModule` imports:
```ts
// src/expenses/expenses.module.ts
import { Expense, User, Vehicle, ExpenseCategory } from 'src/entities';
// ...
imports: [TypeOrmModule.forFeature([Expense, Vehicle, User, ExpenseCategory])],
```

- [ ] **Step 2: Fix the report pivot in resports.service**

In `src/resports/resports.service.ts`, the `allExpenses` query must load the category relation, and the pivot key must use the category name:
- Add `.leftJoinAndSelect('expense.category', 'category')` to the `allExpenses` query builder.
- Change the pivot category line from `const cat = exp.category || 'Gasto General';` to:
  ```ts
  const cat = exp.category?.name || 'Sin categoría';
  ```
- In the "Desglose Detallado" sheet row (`allExpenses.forEach(e => ...)`), change `e.category` to `e.category?.name || ''`.

- [ ] **Step 3: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: only the 2 pre-existing `src/auth/*.spec.ts` errors remain. Zero errors related to expense category. Paste the full remaining list into your report.

- [ ] **Step 4: Commit**

```bash
git add src/expenses/expenses.service.ts src/expenses/expenses.module.ts src/resports/resports.service.ts
git commit -m "fix(expenses,reports): use categoryId FK and category.name after enum removal"
```

---

### Task 6: Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the new + existing expense specs**

Run: `npx jest src/expense-categories/expense-categories.service.spec.ts src/expenses/expenses.service.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: only the 2 pre-existing unrelated `src/auth/*.spec.ts` errors.

- [ ] **Step 3: Full-suite regression check**

Run: `npx jest 2>&1 | tail -5`
Expected: the same pre-existing scaffold-spec suites fail as on the branch base (no newly-broken suite); the expense-categories and expenses suites pass.

- [ ] **Step 4: DEFERRED — DB run (needs a live database)**

After the user runs the pre-migration audit and `npm run migration:run`:
- Confirm the migration completed (verify-gate passed → no unmapped legacy values).
- `GET /expense-categories` returns the 5 groups with their categories (legacy ones `isSystem:true`, new ones `isSystem:false`).
- Create a user category (POST), confirm it is editable and deletable when unused; confirm DELETE on a system category returns 409.
- Spot-check an existing expense: its `categoryId` points to the category whose `name` equals its old value.

---

## Notes / Out of Scope

- **Frontend** (expense form category dropdown grouped by section; category/group admin screen) consumes `GET /expense-categories` and the CRUD endpoints — separate repo.
- The `ExpenseCategory` **enum** file (`src/common/enums/category-enum.ts`) is left in place (still re-exported from `src/common/enums`); after this change it is unused by expenses but removing it is a separate cleanup (verify no other references first).
- This branch is off `main` and does NOT include the unmerged `feat/expense-proration-by-period` work; migration numbering (`…030`) avoids collision with that branch's `…029`.
- Migration run + e2e verification deferred to an environment with a live DB.
