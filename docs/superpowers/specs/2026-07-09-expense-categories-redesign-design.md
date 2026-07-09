# Expense Categories Redesign — Design Spec

**Date:** 2026-07-09
**Repo:** pmy-api (backend/API only; frontend consumes the API separately)
**Status:** Approved design, pre-implementation

## 1. Overview & Goals

Replace the hardcoded `ExpenseCategory` enum with a **normalized, data-driven** category model backed by two dedicated tables, so expense categories can be **grouped**, **created, edited, reordered, and deleted** from the API. Existing enum categories are preserved as **system** (protected) rows so historical expense data stays valid; the new category list is added as **user** (editable/deletable) rows.

**Goals**
- Categories and their groups live in tables (single source of truth), not an enum.
- `isSystem=true` rows (the 11 legacy values) cannot be deleted; user rows can be deleted only when not in use.
- Groups (the 5 sections) are themselves manageable (create/rename/reorder/delete).
- Migrate the existing ~2,322 expenses deterministically to a foreign key with **zero orphaned rows**.
- Retire the `ExpenseCategory` enum and **deregister `expense_category` from the generic catalog** (`catalog-definition.ts`) so there is exactly one categories mechanism.

**Non-goals (out of scope)**
- Frontend UI (expense form, category admin screen) — separate repo; this spec delivers the API and grouped responses it consumes.
- Changing income/shipment/charge/consolidated logic.

## 2. Current State (facts)

- `expense.category` is a MySQL `enum` column (`src/entities/expense.entity.ts`) typed to `ExpenseCategory` (`src/common/enums/category-enum.ts`), storing the Spanish label verbatim.
- Enum values (11): `Nómina`, `Renta`, `Recarga`, `Peajes`, `Servicios`, `Combustible`, `Otros gastos`, `Mantenimiento`, `Impuestos`, `Seguros`, `Viáticos`.
- A dedicated entity `src/entities/expense-category.entity.ts` (table `expense_category`, `OneToMany` to Expense) **already exists but is orphaned/unused** (the relation never matched the enum column). This redesign completes it.
- The generic catalog (`catalog_item`) registers `expense_category` in `src/catalog/catalog-definition.ts` (`{ type: 'expense_category', enumObj: ExpenseCategory }`, usage `{ table: 'expense', column: 'category' }`). This registration is removed by this redesign.
- Consumers reading `expense.category`: `src/expenses/expenses.service.ts` (create + Excel import sets `ExpenseCategory.Combustible`), `src/resports/resports.service.ts` (report pivot groups by category label). `kpi.service`/`income.service` do NOT group by category.

## 3. Data Model

### 3.1 `expense_category_group` (new table — manageable groups)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar | e.g. "Personal y Nómina" |
| `icon` | varchar NULL | emoji, e.g. "👥" |
| `sortOrder` | int, default 0 | display order |
| `isSystem` | boolean, default false | seeded groups = true (protected from delete) |
| `active` | boolean, default true | soft hide |
| `createdAt` | datetime, default CURRENT_TIMESTAMP | |

### 3.2 `expense_category` (complete the existing orphan entity)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar | display name, editable |
| `groupId` | uuid FK → expense_category_group NULL | nullable (ungrouped allowed) |
| `isSystem` | boolean, default false | legacy 11 = true |
| `active` | boolean, default true | |
| `sortOrder` | int, default 0 | order within group |
| `description` | varchar NULL | keep existing column |
| `createdAt` | datetime, default CURRENT_TIMESTAMP | |

`@ManyToOne(() => ExpenseCategoryGroup)` on `groupId`; `@OneToMany(() => Expense, e => e.category)` retained.

### 3.3 `expense.categoryId` (FK replaces the enum column)

- Add `categoryId` uuid NULL, FK → `expense_category(id)` (`ON DELETE RESTRICT`).
- `@ManyToOne(() => ExpenseCategory) @JoinColumn({ name: 'categoryId' }) category?: ExpenseCategory;`
- The old `category` enum column is **dropped** after backfill.

## 4. Seed (system groups + merged categories)

**Groups (all `isSystem=true`):**

| sortOrder | icon | name |
|---|---|---|
| 1 | 👥 | Personal y Nómina |
| 2 | 🏢 | Instalaciones y Servicios |
| 3 | 🚚 | Vehículos y Operación |
| 4 | 🛣️ | Viajes y Distribución |
| 5 | 📦 | Administrativos y Otros |

**Categories** — legacy-11 are `isSystem=true`; new-only are `isSystem=false`. Overlapping names (legacy AND in the new list) are a **single** row, `isSystem=true`, placed in the group below. Legacy-only values not in the new list (`Renta` generic, `Recarga` generic, `Seguros` generic, `Impuestos`) are kept as `isSystem=true` so historical rows stay mapped.

| Group | Category | isSystem |
|---|---|---|
| Personal y Nómina | Nómina | true (legacy) |
| Personal y Nómina | Carga Social | false |
| Personal y Nómina | Comisiones | false |
| Personal y Nómina | Vacaciones | false |
| Personal y Nómina | Finiquitos / Liquidaciones | false |
| Personal y Nómina | Despensa | false |
| Personal y Nómina | Equipo de Seguridad | false |
| Instalaciones y Servicios | Renta | true (legacy generic) |
| Instalaciones y Servicios | Renta de Oficina | false |
| Instalaciones y Servicios | Renta de Bodega | false |
| Instalaciones y Servicios | Renta de Local | false |
| Instalaciones y Servicios | Renta Habitacional | false |
| Instalaciones y Servicios | Internet | false |
| Instalaciones y Servicios | Agua | false |
| Instalaciones y Servicios | Luz | false |
| Instalaciones y Servicios | Servicios | true (legacy) |
| Instalaciones y Servicios | Papelería | false |
| Instalaciones y Servicios | Artículos de Limpieza | false |
| Vehículos y Operación | Combustible | true (legacy) |
| Vehículos y Operación | Mantenimiento | true (legacy) |
| Vehículos y Operación | Mantenimiento de Bodega | false |
| Vehículos y Operación | Póliza de Seguro | false |
| Vehículos y Operación | Seguros | true (legacy generic) |
| Vehículos y Operación | Revalidación de Unidades | false |
| Vehículos y Operación | Arrendamiento | false |
| Vehículos y Operación | Financiamiento | false |
| Vehículos y Operación | Permisos | false |
| Vehículos y Operación | Permisos de Carga y Descarga | false |
| Vehículos y Operación | Recargas LEO | false |
| Vehículos y Operación | Recargas GPS | false |
| Vehículos y Operación | Saldos LEO y GPS | false |
| Vehículos y Operación | Recarga | true (legacy generic) |
| Viajes y Distribución | Viáticos | true (legacy) |
| Viajes y Distribución | Viáticos de Alimentación | false |
| Viajes y Distribución | Comida Ruta Local | false |
| Viajes y Distribución | Peajes | true (legacy) |
| Viajes y Distribución | Traslados | false |
| Viajes y Distribución | Vuelos | false |
| Viajes y Distribución | Apoyo Carga y Descarga | false |
| Administrativos y Otros | Servicios de Mensajería | false |
| Administrativos y Otros | Otros gastos | true (legacy — name kept verbatim, NOT renamed to "Otros Gastos") |
| Administrativos y Otros | Impuestos | true (legacy) |

> **Naming rule (per user):** existing category names are kept **verbatim** — no renaming. The only new-list label that differed by casing was "Otros Gastos"; it collapses into the legacy "Otros gastos" (single row, system), not a duplicate. All other overlaps already match exactly.

## 5. Migration (deterministic, ~2,322 rows)

Migration number **`1786000000030`+** (note: `…029` is claimed by the unmerged `feat/expense-proration-by-period` branch; use `…030` and up to avoid collision on merge).

**Up:**
1. Create `expense_category_group` and `expense_category` tables.
2. Seed groups (§4) and categories (§4). Capture each category's generated `id`.
3. Add `expense.categoryId` uuid NULL + FK (`ON DELETE RESTRICT`).
4. **Backfill** via an explicit map of the 11 legacy enum strings → target category name. Names are preserved verbatim, so each legacy string maps to a category of the **same name** (the map stays explicit rather than a blind name-join, to fail loudly if a category is missing):
   ```
   'Nómina'      → 'Nómina'
   'Renta'       → 'Renta'
   'Recarga'     → 'Recarga'
   'Peajes'      → 'Peajes'
   'Servicios'   → 'Servicios'
   'Combustible' → 'Combustible'
   'Otros gastos'→ 'Otros gastos'
   'Mantenimiento'→'Mantenimiento'
   'Impuestos'   → 'Impuestos'
   'Seguros'     → 'Seguros'
   'Viáticos'    → 'Viáticos'
   ```
   For each mapping: `UPDATE expense SET categoryId = <id of target category> WHERE category = '<legacy value>'`.
   Also handle NULL/empty legacy `category` → leave `categoryId` NULL.
5. **Verify gate:** `SELECT COUNT(*) FROM expense WHERE category IS NOT NULL AND category <> '' AND categoryId IS NULL` must be `0`. If not, the migration aborts (a legacy value did not map) — reconcile before proceeding.
6. Drop the old `category` enum column.

**Down:** re-add `category` enum column; backfill `category` from the joined `expense_category.name` (best-effort inverse via the same map); drop `expense.categoryId`; drop the two tables.

**Pre-migration audit (gate, like prior work):** a `docs/.../audit-expense-categories.sql` that lists `SELECT DISTINCT category, COUNT(*) FROM expense GROUP BY category` so we confirm every distinct stored value is covered by the map before running (catches any legacy value outside the 11).

## 6. Code Changes

### 6.1 Entities
- `expense-category-group.entity.ts` (new).
- `expense-category.entity.ts` (complete: add `groupId`/`isSystem`/`active`/`sortOrder`, `@ManyToOne` group).
- `expense.entity.ts`: remove the `category` enum column; add `@ManyToOne(() => ExpenseCategory)` + `categoryId`. Register both new entities in the TypeORM entity list / `src/entities` index and the relevant module(s).

### 6.2 CRUD module `expense-categories`
Controller + service. Endpoints:
- `GET /expense-categories` — grouped payload for the form: `[{ group: {id,name,icon,sortOrder}, categories: [{id,name,sortOrder,isSystem,active}] }]`, ordered by group.sortOrder then category.sortOrder, `active=true` by default (query `?includeInactive=true` to get all).
- `POST /expense-categories` — create (isSystem forced false; requires name; groupId optional).
- `PATCH /expense-categories/:id` — edit name/groupId/sortOrder/active/description. Cannot change `isSystem`.
- `DELETE /expense-categories/:id` — blocked if `isSystem`; blocked if any expense references it (409 with count); else delete.
- `GET /expense-categories/groups`, `POST`, `PATCH /:id`, `DELETE /:id` — group CRUD. Group delete blocked if `isSystem` or if it has categories (409).

Delete rules mirror the proven catalog logic (system protection + in-use check). Service reuses a small `countUsage(categoryId)` = `expense` rows with that `categoryId`.

### 6.3 Consumers
- `expenses.service.create`: accept `categoryId`; validate it exists (400 if not). Excel import (`importFromExcel`): resolve the "Combustible" category id once (lookup by name) and set `categoryId` on each imported row instead of the enum.
- `resports.service` (`generateIncomeStatementReport`): load the `category` relation on the expense query and change the pivot key from `exp.category` (string) to `exp.category?.name ?? 'Sin categoría'`.
- `kpi.service` / `income.service`: no category grouping — verify they still compile with the entity change; the proration/aggregation logic is unchanged. (Note: these files may differ once the proration branch merges; this branch is off `main` and does not include it.)
- Remove `ExpenseCategory` enum import usages; delete the `expense_category` registration from `catalog-definition.ts` (its `CATALOG_DEFS` entry and its `usage` mapping). Keep the enum file only if still referenced elsewhere; otherwise delete it.

## 7. Testing

- **Unit (Jest):** category CRUD service — create forces `isSystem=false`; delete blocked when `isSystem`; delete blocked when in use (mocked `countUsage>0`); delete succeeds when unused; group delete blocked when it has categories. Pure-ish logic with a mocked repo (same pattern as the existing `expenses.service.spec.ts`).
- **Migration verification:** the verify-gate query (§5.5) returns 0; spot-check that a known legacy value (e.g. an expense with `category='Otros gastos'`) ends with `categoryId` = the "Otros Gastos" row.
- **tsc:** clean except the 2 pre-existing unrelated `src/auth/*.spec.ts` module errors.
- **Deferred to user (no DB here):** `npm run migration:run`, the pre-migration audit, and the e2e check that the grouped `GET /expense-categories` returns the 5 groups with their categories.

## 8. Risks & Mitigations
- **Unmapped legacy value** → the audit (§5) + verify-gate (§5.5) catch it before dropping the old column.
- **Migration number collision** with the unmerged proration branch → use `…030`+.
- **Two-systems drift** → explicitly deregister `expense_category` from the generic catalog in this change.
- **Consumer breakage from string→relation** → tsc + the reports pivot change pin it; `kpi`/`income` don't group by category.
