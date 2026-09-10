# Consolidador de Finanzas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herramienta operable en Finanzas para conciliar, por sucursal y semana (lun–dom), ingresos de todo tipo: editar costos de carga in-place, alta manual de ingresos, y corregir estatus de paquetes contra FedEx.

**Architecture:** Módulo backend nuevo `src/consolidador/` (lectura agregada + escritura in-place de `income` + corrección de `shipment.status` usando `FedexStatusResolver` read-only) y página frontend nueva `app/finanzas/consolidador` (shadcn+Tailwind, SWR). Se deja intacto `src/income` (solo lectura) y `app/ingresos` (reportes).

**Tech Stack:** NestJS + TypeORM + MySQL + Jest (BE). Next.js (app router) + shadcn/ui + Tailwind + SWR + axios + Vitest (FE).

## Global Constraints

- Esquema **SIEMPRE por migración** (`DB_SYNC=false` en todos los entornos, incl. dev). Última migración en repo: `1786000000064`; la nueva es `1786000000065`.
- Edición de dinero **in-place** sobre la fila `income` (sin filas de reversa). Se estampa `originalCost` (1er ajuste), `updatedById`, `updatedAt`, `editReason`.
- **Solo** se modifica `income`, salvo la corrección de estatus que escribe `shipment.status` (+ ajusta el income ligado).
- FedEx: **solo lectura** vía `FedexStatusResolver.getLatestStatus(trackingNumber, opts)`. Si falla (`found:false`/`error`), **no** se corrige estatus.
- Semana **lunes–domingo** (usar `lib/week` en FE; en BE el módulo trae su propio helper alineado — ver memoria `week-range-lun-dom`).
- **UI**: toda pantalla dentro de `AppLayout` + `withAuth` + `OperationHeader`, construida **solo** con `@/components/ui/*` (shadcn) + Tailwind. Nada de HTML crudo suelto.
- FE usa **SWR** (`useSWR` + `mutate`), no react-query. Servicios en `lib/services/*` con `axiosConfig`.
- Enums exactos: `IncomeSourceType` = `shipment|collection|charge|manual|tyco|aeropuerto|special_transfer`. `IncomeStatus` = `entregado|rechazado|no_entregado|cliente_no_disponible_3ra_visita|tyco|aeropuerto|traslado_especial`. `shipment.status: ShipmentStatusType`.
- Todo write valida `cost >= 0` y `reason` no vacío (DTO `class-validator` + validación FE).

## File Structure

**Backend (`pmy-api`):**
- `src/database/migrations/1786000000065-AddIncomeConsolidadorAudit.ts` — columnas de auditoría en `income`.
- `src/entities/income.entity.ts` — modificar: 4 columnas nuevas.
- `src/consolidador/consolidador.module.ts` — wiring.
- `src/consolidador/consolidador.controller.ts` — rutas `/consolidador/*`.
- `src/consolidador/read/consolidador-read.service.ts` — agregación + filtros.
- `src/consolidador/income/consolidador-income.service.ts` — cost edit, 2º a bordo, alta manual.
- `src/consolidador/status/consolidador-status.service.ts` — búsqueda + compare FedEx + aplicar.
- `src/consolidador/logic/second-abord.util.ts` — `computeSecondAbordDelta` (puro).
- `src/consolidador/logic/manual-income.util.ts` — `resolveManualIncomeCost` (puro).
- `src/consolidador/logic/status-correction.util.ts` — `deriveStatusCorrection` (puro).
- `src/consolidador/logic/consolidador-week.util.ts` — `getWeekRangeMxLunDom` (puro).
- `src/consolidador/dto/*.dto.ts` — DTOs de request.
- `src/consolidador/logic/*.spec.ts` — tests de funciones puras.
- `src/auth/guards/consolidador-access.guard.ts` — guard role-based (espeja `IncomeAccessGuard`, roles de escritura acotados).
- `src/app.module.ts` — registrar `ConsolidadorModule`.

**Frontend (`app-pmy`):**
- `lib/services/consolidador.ts` — cliente HTTP.
- `lib/types/consolidador.ts` — tipos compartidos FE.
- `hooks/services/consolidador/use-consolidador.ts` — SWR (lectura + mutaciones).
- `app/finanzas/consolidador/page.tsx` — página.
- `components/consolidador/consolidador-toolbar.tsx` — sucursal + semana + filtros.
- `components/consolidador/consolidador-kpis.tsx` — tarjetas por bucket.
- `components/consolidador/consolidador-table.tsx` — tabla con acciones inline.
- `components/consolidador/edit-cost-dialog.tsx` — editar costo carga.
- `components/consolidador/add-income-dialog.tsx` — alta manual.
- `components/consolidador/search-package-dialog.tsx` — búsqueda + estatus FedEx.
- `components/consolidador/*.test.tsx` — Vitest.
- `lib/access/permissions.ts` + `lib/access/allowed-page-roles.ts` — registrar `finanzas.consolidador`.

---

## FASE F0 — Lectura agregada

### Task 1: Migración + columnas de auditoría en `income`

**Files:**
- Create: `src/database/migrations/1786000000065-AddIncomeConsolidadorAudit.ts`
- Modify: `src/entities/income.entity.ts` (tras la línea 97, después de `sourceEventKey`)

**Interfaces:**
- Produces: entidad `Income` con `originalCost?: number|null`, `updatedById?: string|null`, `updatedAt?: Date|null`, `editReason?: string|null`.

- [ ] **Step 1: Agregar columnas a la entidad**

En `src/entities/income.entity.ts`, después de la propiedad `sourceEventKey` (L97):

```typescript
  /** Snapshot del `cost` antes del PRIMER ajuste in-place del consolidador. Null = nunca editado. */
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  originalCost?: number | null;

  /** Auditoría de la última edición in-place hecha desde el consolidador. */
  @Column({ type: 'char', length: 36, nullable: true })
  updatedById?: string | null;

  @Column({ type: 'datetime', nullable: true })
  updatedAt?: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  editReason?: string | null;
```

- [ ] **Step 2: Escribir la migración**

`src/database/migrations/1786000000065-AddIncomeConsolidadorAudit.ts` (copiar el estilo de `1786000000064-AddIncomeAnnulment.ts` — `queryRunner.hasColumn` antes de `addColumn` para idempotencia):

```typescript
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIncomeConsolidadorAudit1786000000065 implements MigrationInterface {
  name = 'AddIncomeConsolidadorAudit1786000000065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const add = async (col: TableColumn) => {
      if (!(await queryRunner.hasColumn('income', col.name))) {
        await queryRunner.addColumn('income', col);
      }
    };
    await add(new TableColumn({ name: 'originalCost', type: 'decimal', precision: 10, scale: 2, isNullable: true }));
    await add(new TableColumn({ name: 'updatedById', type: 'char', length: '36', isNullable: true }));
    await add(new TableColumn({ name: 'updatedAt', type: 'datetime', isNullable: true }));
    await add(new TableColumn({ name: 'editReason', type: 'varchar', length: '255', isNullable: true }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['editReason', 'updatedAt', 'updatedById', 'originalCost']) {
      if (await queryRunner.hasColumn('income', name)) {
        await queryRunner.dropColumn('income', name);
      }
    }
  }
}
```

- [ ] **Step 3: Compilar**

Run: `cd C:/PMY/pmy-api && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en `income.entity.ts` ni en la migración.

- [ ] **Step 4: Commit**

```bash
git add src/entities/income.entity.ts src/database/migrations/1786000000065-AddIncomeConsolidadorAudit.ts
git commit -m "feat(consolidador): columnas de auditoría in-place en income (mig 065)"
```

---

### Task 2: Helper de semana lun–dom (puro) + test

**Files:**
- Create: `src/consolidador/logic/consolidador-week.util.ts`
- Test: `src/consolidador/logic/consolidador-week.util.spec.ts`

**Interfaces:**
- Produces: `getWeekRangeMxLunDom(anchor: Date): { from: Date; to: Date }` — lunes 00:00 a domingo 23:59:59.999 (hora local MX del `anchor`).

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { getWeekRangeMxLunDom } from './consolidador-week.util';

describe('getWeekRangeMxLunDom', () => {
  it('miércoles cae en su semana lun–dom', () => {
    const { from, to } = getWeekRangeMxLunDom(new Date('2026-09-09T12:00:00')); // mié
    expect(from.getDay()).toBe(1); // lunes
    expect(to.getDay()).toBe(0);   // domingo
    expect(to.getTime() - from.getTime()).toBeGreaterThan(6 * 24 * 3600 * 1000);
  });
  it('domingo pertenece a la semana que termina ese domingo (no la siguiente)', () => {
    const { from, to } = getWeekRangeMxLunDom(new Date('2026-09-13T23:00:00')); // dom
    expect(from.getDate()).toBe(7);  // lunes 7
    expect(to.getDate()).toBe(13);   // domingo 13
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/consolidador-week.util.spec.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```typescript
/** Rango semanal lunes–domingo alrededor de `anchor` (interpretado en hora local del server). */
export function getWeekRangeMxLunDom(anchor: Date): { from: Date; to: Date } {
  const d = new Date(anchor);
  const dow = d.getDay();                 // 0=dom..6=sáb
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const from = new Date(d);
  from.setDate(d.getDate() - backToMonday);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/consolidador-week.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consolidador/logic/consolidador-week.util.*
git commit -m "feat(consolidador): helper puro de semana lun–dom + test"
```

---

### Task 3: Read service + DTO + controller GET + módulo + guard

**Files:**
- Create: `src/auth/guards/consolidador-access.guard.ts`
- Create: `src/consolidador/read/consolidador-read.service.ts`
- Create: `src/consolidador/dto/consolidador-query.dto.ts`
- Create: `src/consolidador/consolidador.controller.ts`
- Create: `src/consolidador/consolidador.module.ts`
- Modify: `src/app.module.ts` (agregar `ConsolidadorModule` a `imports`)
- Test: `src/consolidador/read/consolidador-read.service.spec.ts`

**Interfaces:**
- Consumes: `getWeekRangeMxLunDom` (Task 2), repos TypeORM de `Income`.
- Produces:
  - `ConsolidadorRow = { id: string; trackingNumber: string|null; sourceType: IncomeSourceType; incomeType: IncomeStatus; cost: number; originalCost: number|null; date: string; consNumber: string|null; routeId: string|null; shipmentId: string|null; shipmentStatus: ShipmentStatusType|null; editReason: string|null }`
  - `ConsolidadorBuckets = { envios: {amount:number;count:number}; cargas:...; recolecciones:...; traslados:...; manual:...; total:{amount:number;count:number} }`
  - `ConsolidadorReadResult = { rows: ConsolidadorRow[]; buckets: ConsolidadorBuckets }`
  - `ConsolidadorReadService.getWeek(subsidiaryId: string, fromDate: Date, toDate: Date, filters: { consNumber?: string; routeId?: string }): Promise<ConsolidadorReadResult>`
  - Guard `ConsolidadorAccessGuard`.

- [ ] **Step 1: Guard role-based (espeja IncomeAccessGuard)**

`src/auth/guards/consolidador-access.guard.ts` — copiar `income-access.guard.ts` cambiando el nombre de la clase a `ConsolidadorAccessGuard` y **acotando escritura**: mantén `FINANCE_ROLES` para lectura, y expón `static WRITE_ROLES = ['admin','subadmin','superadmin','superamin','owner']` (sin `auxiliar`). El `canActivate` sigue igual (lectura). La restricción de escritura se aplica por método en Task 5/7/10 vía `req.method !== 'GET'` → exigir `WRITE_ROLES`.

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class ConsolidadorAccessGuard implements CanActivate {
  static readonly FINANCE_ROLES = ['admin','subadmin','superadmin','superamin','owner','auxiliar'];
  static readonly WRITE_ROLES  = ['admin','subadmin','superadmin','superamin','owner'];
  static readonly GLOBAL_ROLES = ['superadmin','superamin','owner'];

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const req = context.switchToHttp().getRequest();
    const role = (req.user?.role || '').toString().toLowerCase();
    if (!ConsolidadorAccessGuard.FINANCE_ROLES.includes(role)) {
      throw new ForbiddenException('No tienes acceso al consolidador.');
    }
    if (req.method !== 'GET' && !ConsolidadorAccessGuard.WRITE_ROLES.includes(role)) {
      throw new ForbiddenException('No puedes editar en el consolidador.');
    }
    const requested = req.params?.subsidiaryId;
    if (requested && !ConsolidadorAccessGuard.GLOBAL_ROLES.includes(role)) {
      const allowed: string[] = req.user?.subsidiaryIds || [];
      if (!allowed.includes(requested)) {
        throw new ForbiddenException('Solo puedes operar tus sucursales asignadas.');
      }
    }
    return true;
  }
}
```

- [ ] **Step 2: DTO de query**

`src/consolidador/dto/consolidador-query.dto.ts`:

```typescript
import { IsOptional, IsString } from 'class-validator';
export class ConsolidadorQueryDto {
  @IsOptional() @IsString() consNumber?: string;
  @IsOptional() @IsString() routeId?: string;
}
```

- [ ] **Step 3: Escribir el test que falla (read service)**

Test unitario con `Income` repo mockeado (patrón: `createQueryBuilder` que retorna un builder chainable cuyo `.getMany()` resuelve filas fixture). Verifica: (a) filtra por semana, (b) agrupa buckets, (c) `traslados` = tyco+aeropuerto+special_transfer.

```typescript
import { ConsolidadorReadService } from './consolidador-read.service';

const rows = [
  { id: '1', sourceType: 'shipment', incomeType: 'entregado', cost: '100', date: new Date('2026-09-09'), charge: null, shipment: { id: 's1', status: 'entregado' } },
  { id: '2', sourceType: 'charge', incomeType: 'entregado', cost: '4000', date: new Date('2026-09-09'), charge: { id: 'c1', consNumber: 'CN1' }, shipment: null },
  { id: '3', sourceType: 'tyco', incomeType: 'tyco', cost: '50', date: new Date('2026-09-09'), charge: null, shipment: null },
];
function repoMock() {
  const qb: any = {};
  ['leftJoinAndSelect','where','andWhere'].forEach(m => qb[m] = () => qb);
  qb.getMany = async () => rows;
  return { createQueryBuilder: () => qb } as any;
}

describe('ConsolidadorReadService.getWeek', () => {
  it('agrupa buckets y mapea filas', async () => {
    const svc = new ConsolidadorReadService(repoMock());
    const res = await svc.getWeek('sub', new Date('2026-09-07'), new Date('2026-09-13'), {});
    expect(res.rows).toHaveLength(3);
    expect(res.buckets.envios.amount).toBe(100);
    expect(res.buckets.cargas.amount).toBe(4000);
    expect(res.buckets.traslados.amount).toBe(50);
    expect(res.buckets.total.amount).toBe(4150);
  });
});
```

- [ ] **Step 4: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/read/consolidador-read.service.spec.ts`
Expected: FAIL (servicio no existe).

- [ ] **Step 5: Implementar el read service**

`src/consolidador/read/consolidador-read.service.ts`. Construye el query base con la ventana semanal y joins a `shipment` y `charge`; aplica filtros `consNumber` (por `charge.consNumber`) y `routeId` (por join a `package_dispatch` del shipment — usar el nombre real de la relación al implementar; si no hay relación directa, filtrar por subquery de `package_dispatch.routeId`). Mapea a `ConsolidadorRow` y agrega buckets.

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Income } from 'src/entities/income.entity';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';

const TRASLADO = ['tyco','aeropuerto','special_transfer'];
type Bucket = { amount: number; count: number };

@Injectable()
export class ConsolidadorReadService {
  constructor(@InjectRepository(Income) private readonly incomeRepo: Repository<Income>) {}

  async getWeek(subsidiaryId: string, fromDate: Date, toDate: Date, filters: { consNumber?: string; routeId?: string }) {
    const qb = this.incomeRepo.createQueryBuilder('income')
      .leftJoinAndSelect('income.shipment', 'shipment')
      .leftJoinAndSelect('income.charge', 'charge')
      .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('income.date BETWEEN :fromDate AND :toDate', { fromDate, toDate })
      .andWhere('income.active = 1');
    if (filters.consNumber) qb.andWhere('charge.consNumber = :consNumber', { consNumber: filters.consNumber });
    if (filters.routeId) {
      qb.andWhere(`shipment.id IN (SELECT pds.shipmentId FROM package_dispatch_shipment pds WHERE pds.routeId = :routeId)`, { routeId: filters.routeId });
      // NOTA impl: ajustar tabla/columna real de la relación ruta↔shipment al implementar.
    }
    const list = await qb.getMany();
    const rows = list.map((i) => this.toRow(i));
    return { rows, buckets: this.buckets(rows) };
  }

  private toRow(i: any) {
    return {
      id: i.id,
      trackingNumber: i.trackingNumber ?? null,
      sourceType: i.sourceType as IncomeSourceType,
      incomeType: i.incomeType,
      cost: Number(i.cost),
      originalCost: i.originalCost != null ? Number(i.originalCost) : null,
      date: (i.date instanceof Date ? i.date : new Date(i.date)).toISOString(),
      consNumber: i.charge?.consNumber ?? null,
      routeId: null as string | null, // poblar si se resuelve la relación de ruta
      shipmentId: i.shipment?.id ?? null,
      shipmentStatus: i.shipment?.status ?? null,
      editReason: i.editReason ?? null,
    };
  }

  private buckets(rows: ReturnType<ConsolidadorReadService['toRow']>[]) {
    const mk = (): Bucket => ({ amount: 0, count: 0 });
    const b = { envios: mk(), cargas: mk(), recolecciones: mk(), traslados: mk(), manual: mk(), total: mk() };
    for (const r of rows) {
      const key = r.sourceType === 'shipment' ? 'envios'
        : r.sourceType === 'charge' ? 'cargas'
        : r.sourceType === 'collection' ? 'recolecciones'
        : TRASLADO.includes(String(r.sourceType)) ? 'traslados' : 'manual';
      (b as any)[key].amount += r.cost; (b as any)[key].count += 1;
      b.total.amount += r.cost; b.total.count += 1;
    }
    return b;
  }
}
```

- [ ] **Step 6: Controller + módulo + registro**

`src/consolidador/consolidador.controller.ts`:

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConsolidadorAccessGuard } from 'src/auth/guards/consolidador-access.guard';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorQueryDto } from './dto/consolidador-query.dto';
import { getWeekRangeMxLunDom } from './logic/consolidador-week.util';

@ApiTags('consolidador')
@ApiBearerAuth()
@UseGuards(ConsolidadorAccessGuard)
@Controller('consolidador')
export class ConsolidadorController {
  constructor(private readonly read: ConsolidadorReadService) {}

  @Get(':subsidiaryId/:fromDate/:toDate')
  getWeek(
    @Param('subsidiaryId') subsidiaryId: string,
    @Param('fromDate') fromDate: string,
    @Param('toDate') toDate: string,
    @Query() q: ConsolidadorQueryDto,
  ) {
    // Los params vienen ya como límites de la semana desde el FE; se respetan tal cual.
    return this.read.getWeek(subsidiaryId, new Date(fromDate), new Date(toDate), q);
  }
}
```

`src/consolidador/consolidador.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, Shipment } from 'src/entities';
import { ConsolidadorController } from './consolidador.controller';
import { ConsolidadorReadService } from './read/consolidador-read.service';

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment])],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService],
})
export class ConsolidadorModule {}
```

Registrar `ConsolidadorModule` en `imports` de `src/app.module.ts`.

- [ ] **Step 7: Correr test + compilar**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/read/consolidador-read.service.spec.ts && npx tsc --noEmit`
Expected: PASS + sin errores TS.

- [ ] **Step 8: Commit**

```bash
git add src/consolidador src/auth/guards/consolidador-access.guard.ts src/app.module.ts
git commit -m "feat(consolidador): lectura agregada por sucursal+semana (buckets, filtros, guard)"
```

---

### Task 4: FE — servicio, hook SWR, tipos y permiso

**Files:**
- Create: `lib/types/consolidador.ts`
- Create: `lib/services/consolidador.ts`
- Create: `hooks/services/consolidador/use-consolidador.ts`
- Modify: `lib/access/permissions.ts` y `lib/access/allowed-page-roles.ts` (agregar `finanzas.consolidador`)

**Interfaces:**
- Produces:
  - Tipos FE espejo de `ConsolidadorRow`/`ConsolidadorBuckets`/`ConsolidadorReadResult`.
  - `getConsolidadorWeek(subsidiaryId, from, to, filters): Promise<ConsolidadorReadResult>`
  - `useConsolidadorWeek(subsidiaryId, from, to, filters)` → `{ data, isLoading, isError, mutate }` (SWR).

- [ ] **Step 1: Tipos**

`lib/types/consolidador.ts` — declarar `ConsolidadorRow`, `ConsolidadorBucket = { amount: number; count: number }`, `ConsolidadorBuckets` (envios/cargas/recolecciones/traslados/manual/total), `ConsolidadorReadResult = { rows: ConsolidadorRow[]; buckets: ConsolidadorBuckets }`, con los mismos campos que el Task 3.

- [ ] **Step 2: Servicio HTTP**

`lib/services/consolidador.ts`:

```typescript
import { axiosConfig } from "../axios-config";
import { ConsolidadorReadResult } from "../types/consolidador";

const baseUrl = "/consolidador";

export const getConsolidadorWeek = async (
  subsidiaryId: string, from: string, to: string,
  filters: { consNumber?: string; routeId?: string } = {},
): Promise<ConsolidadorReadResult> => {
  const params = new URLSearchParams();
  if (filters.consNumber) params.set("consNumber", filters.consNumber);
  if (filters.routeId) params.set("routeId", filters.routeId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await axiosConfig.get<ConsolidadorReadResult>(`${baseUrl}/${subsidiaryId}/${from}/${to}${qs}`);
  return res.data;
};
```

- [ ] **Step 3: Hook SWR**

`hooks/services/consolidador/use-consolidador.ts`:

```typescript
import useSWR from "swr";
import { getConsolidadorWeek } from "@/lib/services/consolidador";
import { ConsolidadorReadResult } from "@/lib/types/consolidador";

export function useConsolidadorWeek(
  subsidiaryId: string, from: string, to: string,
  filters: { consNumber?: string; routeId?: string } = {},
) {
  const isValid = Boolean(subsidiaryId && from && to);
  const key = isValid ? ["/consolidador", subsidiaryId, from, to, filters.consNumber ?? "", filters.routeId ?? ""] : null;
  const { data, error, isLoading, mutate } = useSWR<ConsolidadorReadResult>(
    key,
    ([, sub, f, t, cons, route]: string[]) => getConsolidadorWeek(sub, f, t, { consNumber: cons || undefined, routeId: route || undefined }),
  );
  return { data, isLoading, isError: !!error, mutate };
}
```

- [ ] **Step 4: Registrar permiso de página**

En `lib/access/permissions.ts` y `lib/access/allowed-page-roles.ts`, agregar la clave `finanzas.consolidador` con los mismos roles de finanzas que usa `finanzas.ingresos` (seguir el patrón exacto del archivo).

- [ ] **Step 5: Verificar tipos FE**

Run: `cd C:/PMY/app-pmy && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add lib/types/consolidador.ts lib/services/consolidador.ts hooks/services/consolidador lib/access/permissions.ts lib/access/allowed-page-roles.ts
git commit -m "feat(consolidador): servicio/hook SWR de lectura + permiso finanzas.consolidador"
```

---

### Task 5: FE — página + toolbar + KPIs + tabla read-only

**Files:**
- Create: `app/finanzas/consolidador/page.tsx`
- Create: `components/consolidador/consolidador-toolbar.tsx`
- Create: `components/consolidador/consolidador-kpis.tsx`
- Create: `components/consolidador/consolidador-table.tsx`

**Interfaces:**
- Consumes: `useConsolidadorWeek` (Task 4), `SucursalSelector`, `lib/week` `getWeekRange`, `OperationHeader`, `AppLayout`, `withAuth`.
- Produces: página navegable en `/finanzas/consolidador`.

- [ ] **Step 1: Toolbar**

`components/consolidador/consolidador-toolbar.tsx` — recibe `{ subsidiaryId, onSubsidiary, weekAnchor, onWeekChange, consNumber, routeId, onFilters, consOptions, routeOptions }`. Usa `SucursalSelector` (mismas props que en `ingresos`: `value` + `onValueChange`), botones ‹ › para mover `weekAnchor` ±7 días, y dos `Popover` shadcn (Consolidado, Ruta) que listan `consOptions`/`routeOptions` derivadas de las filas de la semana. Solo `@/components/ui/*`.

- [ ] **Step 2: KPIs**

`components/consolidador/consolidador-kpis.tsx` — recibe `buckets: ConsolidadorBuckets`, renderiza 5 `Card` (Envíos, Cargas, Recolecciones, Traslados, Manual) + Total, cada una con `formatCurrency(amount)` y `count`. Espeja el estilo de las cards de `app/ingresos/page.tsx`.

- [ ] **Step 3: Tabla**

`components/consolidador/consolidador-table.tsx` — recibe `rows: ConsolidadorRow[]` y renderiza `Table` shadcn con columnas: Tipo (Badge por `sourceType`), Tracking/Cons, Estatus (Badge `shipmentStatus`), Fecha, Costo (si `originalCost != null`, mostrar tachado `originalCost` → `cost`). Sin acciones aún (se agregan en F1/F2/F3). Slot `actions?: (row) => ReactNode` para inyectarlas luego.

- [ ] **Step 4: Página**

`app/finanzas/consolidador/page.tsx` — `withAuth(Consolidador, "finanzas.consolidador")`, dentro de `AppLayout` + `OperationHeader` (icono `SlidersHorizontal`, título "Consolidador de Finanzas"). Estado: `subsidiaryId`, `weekAnchor` (Date, hoy), `consNumber`, `routeId`. Deriva `{from,to}` con `getWeekRange` sobre `weekAnchor` (formato `YYYY-MM-DD`). Llama `useConsolidadorWeek`. Compone Toolbar + KPIs + Table. Overlay `Loader2` como en `ingresos`.

- [ ] **Step 5: Verificar en el navegador (preview)**

Levantar el dev server de `app-pmy` (`preview_start` name del launch.json, o crear uno). Navegar a `/finanzas/consolidador`, elegir sucursal, ver KPIs+tabla. `read_console_messages` sin errores. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add app/finanzas/consolidador components/consolidador
git commit -m "feat(consolidador): página lectura (toolbar semana lun-dom, KPIs, tabla)"
```

---

## FASE F1 — Editar costos de carga

### Task 6: `computeSecondAbordDelta` (puro) + test

**Files:**
- Create: `src/consolidador/logic/second-abord.util.ts`
- Test: `src/consolidador/logic/second-abord.util.spec.ts`

**Interfaces:**
- Produces: `computeSecondAbordDelta(currentCost: number, secondAbordAmount: number, enabled: boolean, alreadyIncluded: boolean): number` — nuevo costo. Idempotente: activar cuando ya incluye no dobla; desactivar cuando no incluye no baja; nunca < 0.

- [ ] **Step 1: Test que falla**

```typescript
import { computeSecondAbordDelta } from './second-abord.util';

describe('computeSecondAbordDelta', () => {
  it('quita el 2º a bordo cuando está incluido', () => {
    expect(computeSecondAbordDelta(4594, 594, false, true)).toBe(4000);
  });
  it('pone el 2º a bordo cuando no está incluido', () => {
    expect(computeSecondAbordDelta(4000, 594, true, false)).toBe(4594);
  });
  it('es idempotente: poner cuando ya incluido no dobla', () => {
    expect(computeSecondAbordDelta(4594, 594, true, true)).toBe(4594);
  });
  it('nunca baja de 0', () => {
    expect(computeSecondAbordDelta(100, 594, false, true)).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/second-abord.util.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
export function computeSecondAbordDelta(
  currentCost: number, secondAbordAmount: number, enabled: boolean, alreadyIncluded: boolean,
): number {
  if (enabled === alreadyIncluded) return currentCost;      // ya está en el estado pedido
  const next = enabled ? currentCost + secondAbordAmount : currentCost - secondAbordAmount;
  return Math.max(0, Number(next.toFixed(2)));
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/second-abord.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consolidador/logic/second-abord.util.*
git commit -m "feat(consolidador): computeSecondAbordDelta puro + test"
```

---

### Task 7: Income write service (cost + 2º a bordo) + endpoints

**Files:**
- Create: `src/consolidador/income/consolidador-income.service.ts`
- Create: `src/consolidador/dto/edit-cost.dto.ts`, `src/consolidador/dto/second-abord.dto.ts`
- Modify: `src/consolidador/consolidador.controller.ts` (2 endpoints PATCH)
- Modify: `src/consolidador/consolidador.module.ts` (add provider + `Subsidiary` en forFeature)
- Test: `src/consolidador/income/consolidador-income.service.spec.ts`

**Interfaces:**
- Consumes: `computeSecondAbordDelta` (Task 6), repos `Income`, `Subsidiary`.
- Produces:
  - `ConsolidadorIncomeService.editCost(id: string, cost: number, reason: string, userId: string): Promise<ConsolidadorRow>`
  - `ConsolidadorIncomeService.setSecondAbord(id: string, enabled: boolean, reason: string, userId: string): Promise<ConsolidadorRow>`
  - Reusa `toRow` — mover el mapeo a un helper compartido `src/consolidador/read/consolidador-row.mapper.ts` con `mapIncomeToRow(income): ConsolidadorRow` y consumirlo en Read (Task 3) e Income service.

- [ ] **Step 1: Extraer el mapper compartido**

Crear `src/consolidador/read/consolidador-row.mapper.ts` exportando `mapIncomeToRow(i): ConsolidadorRow` (mismo cuerpo que `toRow` de Task 3) y refactorizar `ConsolidadorReadService` para usarlo. Correr el test de Task 3 para confirmar que sigue verde.

- [ ] **Step 2: DTOs**

```typescript
// edit-cost.dto.ts
import { IsNumber, IsString, Min, MinLength } from 'class-validator';
export class EditCostDto {
  @IsNumber() @Min(0) cost: number;
  @IsString() @MinLength(3) reason: string;
}
// second-abord.dto.ts
import { IsBoolean, IsString, MinLength } from 'class-validator';
export class SecondAbordDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MinLength(3) reason: string;
}
```

- [ ] **Step 3: Test que falla (editCost estampa auditoría)**

```typescript
import { ConsolidadorIncomeService } from './consolidador-income.service';

function makeRepos(income: any) {
  const incomeRepo: any = {
    findOne: async () => income,
    save: async (x: any) => x,
  };
  const subsidiaryRepo: any = { findOne: async () => ({ id: 'sub', secondAbordAmount: 594 }) };
  return { incomeRepo, subsidiaryRepo };
}

describe('ConsolidadorIncomeService.editCost', () => {
  it('guarda originalCost en el 1er ajuste y estampa quién/motivo', async () => {
    const income: any = { id: 'i1', cost: '4594', originalCost: null, sourceType: 'charge', incomeType: 'entregado', date: new Date(), charge: { consNumber: 'CN' }, shipment: null };
    const { incomeRepo, subsidiaryRepo } = makeRepos(income);
    const svc = new ConsolidadorIncomeService(incomeRepo, subsidiaryRepo);
    const row = await svc.editCost('i1', 4000, 'ajuste', 'user-1');
    expect(income.originalCost).toBe(4594);
    expect(income.cost).toBe(4000);
    expect(income.updatedById).toBe('user-1');
    expect(income.editReason).toBe('ajuste');
    expect(row.cost).toBe(4000);
  });
});
```

- [ ] **Step 4: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/income/consolidador-income.service.spec.ts`
Expected: FAIL.

- [ ] **Step 5: Implementar el servicio**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Income } from 'src/entities/income.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { computeSecondAbordDelta } from '../logic/second-abord.util';
import { mapIncomeToRow } from '../read/consolidador-row.mapper';

@Injectable()
export class ConsolidadorIncomeService {
  constructor(
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
  ) {}

  private async load(id: string): Promise<Income> {
    const income = await this.incomeRepo.findOne({ where: { id }, relations: ['shipment', 'charge', 'subsidiary'] });
    if (!income) throw new NotFoundException('Ingreso no encontrado');
    return income;
  }

  private stamp(income: Income, reason: string, userId: string, newCost: number) {
    if (income.originalCost == null) income.originalCost = Number(income.cost);
    income.cost = newCost;
    income.updatedById = userId;
    income.updatedAt = new Date();
    income.editReason = reason;
  }

  async editCost(id: string, cost: number, reason: string, userId: string) {
    const income = await this.load(id);
    this.stamp(income, reason, userId, Number(cost.toFixed(2)));
    await this.incomeRepo.save(income);
    return mapIncomeToRow(income);
  }

  async setSecondAbord(id: string, enabled: boolean, reason: string, userId: string) {
    const income = await this.load(id);
    const amount = Number((income.subsidiary as any)?.secondAbordAmount ?? 0);
    const current = Number(income.cost);
    // alreadyIncluded: heurística — si originalCost existe úsalo, si no, compáralo con el costo base.
    const base = income.originalCost != null ? Number(income.originalCost) : current;
    const alreadyIncluded = current > base || current - amount >= 0 && Math.abs(current - (base + amount)) < 0.01;
    const next = computeSecondAbordDelta(current, amount, enabled, alreadyIncluded);
    this.stamp(income, reason, userId, next);
    await this.incomeRepo.save(income);
    return mapIncomeToRow(income);
  }
}
```

> NOTA impl: `alreadyIncluded` es una heurística. Al implementar, si existe una señal fiable de "esta carga trae 2º a bordo" (p.ej. comparar `cost` contra `subsidiary.chargeCost` base según `isHalfTon`), preferirla. Cubrir el caso con un test extra.

- [ ] **Step 6: Endpoints en el controller**

Agregar a `ConsolidadorController` (inyectar `ConsolidadorIncomeService`; el `userId` sale de `req.user.id` — usar `@Req()` o un decorator existente del repo):

```typescript
@Patch('income/:id/cost')
editCost(@Param('id') id: string, @Body() dto: EditCostDto, @Req() req: any) {
  return this.income.editCost(id, dto.cost, dto.reason, req.user?.id);
}
@Patch('income/:id/second-abord')
setSecondAbord(@Param('id') id: string, @Body() dto: SecondAbordDto, @Req() req: any) {
  return this.income.setSecondAbord(id, dto.enabled, dto.reason, req.user?.id);
}
```

Agregar `Subsidiary` a `TypeOrmModule.forFeature` y `ConsolidadorIncomeService` a `providers` del módulo.

- [ ] **Step 7: Correr test + compilar**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador && npx tsc --noEmit`
Expected: PASS + sin errores TS.

- [ ] **Step 8: Commit**

```bash
git add src/consolidador
git commit -m "feat(consolidador): editar costo in-place + toggle 2º a bordo (endpoints + auditoría)"
```

---

### Task 8: FE — dialog editar costo + toggle 2º a bordo + mutaciones

**Files:**
- Create: `components/consolidador/edit-cost-dialog.tsx`
- Modify: `hooks/services/consolidador/use-consolidador.ts` (mutaciones)
- Modify: `lib/services/consolidador.ts` (patchCost, patchSecondAbord)
- Modify: `components/consolidador/consolidador-table.tsx` (acciones por fila de carga)
- Modify: `app/finanzas/consolidador/page.tsx` (pasar acciones + `mutate`)
- Test: `components/consolidador/edit-cost-dialog.test.tsx`

**Interfaces:**
- Consumes: `useConsolidadorWeek().mutate`.
- Produces: `patchIncomeCost(id, cost, reason)`, `patchSecondAbord(id, enabled, reason)` en el servicio; dialog controlado.

- [ ] **Step 1: Servicio — 2 PATCH**

```typescript
export const patchIncomeCost = async (id: string, cost: number, reason: string) =>
  (await axiosConfig.patch(`${baseUrl}/income/${id}/cost`, { cost, reason })).data;
export const patchSecondAbord = async (id: string, enabled: boolean, reason: string) =>
  (await axiosConfig.patch(`${baseUrl}/income/${id}/second-abord`, { enabled, reason })).data;
```

- [ ] **Step 2: Test del dialog (validación)**

`edit-cost-dialog.test.tsx` (Vitest + Testing Library): al abrir con `cost=4594`, el botón Guardar está deshabilitado si `reason` vacío o `cost < 0`; al escribir motivo y cost válido, `onSubmit` se llama con `{ cost, reason }`.

- [ ] **Step 3: Correr y ver que falla**

Run: `cd C:/PMY/app-pmy && npx vitest run components/consolidador/edit-cost-dialog.test.tsx`
Expected: FAIL (componente no existe).

- [ ] **Step 4: Implementar el dialog**

`edit-cost-dialog.tsx` — `Dialog` shadcn con `Input` numérico (default `row.cost`), muestra `row.originalCost ?? row.cost` como "actual", `Textarea` motivo (requerido), botón Guardar deshabilitado hasta válido. Props `{ row, open, onOpenChange, onSubmit }`.

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd C:/PMY/app-pmy && npx vitest run components/consolidador/edit-cost-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Cablear acciones + toggle en la tabla y la página**

En `consolidador-table.tsx`, para filas `sourceType==='charge'`: botón "Editar costo" (abre dialog) y un `Switch`/botón "2º a bordo". En `page.tsx`, handlers que llaman `patchIncomeCost`/`patchSecondAbord`, luego `mutate()` para refrescar, con `toast` (sonner) éxito/error y rollback (SWR revalida en error).

- [ ] **Step 7: Verificar en navegador**

Preview: editar el costo de una carga, ver antes→ahora en la fila y KPI de Cargas actualizado; toggle 2º a bordo suma/resta el monto. `read_console_messages` limpio. Screenshot.

- [ ] **Step 8: Commit**

```bash
git add components/consolidador lib/services/consolidador.ts hooks/services/consolidador app/finanzas/consolidador
git commit -m "feat(consolidador): FE editar costo de carga + toggle 2º a bordo"
```

---

## FASE F2 — Alta manual de ingresos

### Task 9: `resolveManualIncomeCost` (puro) + POST alta manual

**Files:**
- Create: `src/consolidador/logic/manual-income.util.ts`
- Create: `src/consolidador/dto/create-manual-income.dto.ts`
- Modify: `src/consolidador/income/consolidador-income.service.ts` (`createManual`)
- Modify: `src/consolidador/consolidador.controller.ts` (POST `/income`)
- Test: `src/consolidador/logic/manual-income.util.spec.ts`

**Interfaces:**
- Produces:
  - `type ManualKind = 'recoleccion' | 'pod' | 'dex' | 'manual'`
  - `resolveManualIncomeCost(kind: ManualKind, overrides: { cost?: number }): { cost: number; sourceType: IncomeSourceType; incomeType: IncomeStatus }`
  - `ConsolidadorIncomeService.createManual(dto, userId): Promise<ConsolidadorRow>` con guard anti-duplicado (mismo `trackingNumber`+`date`(día)+`kind` en la semana).

- [ ] **Step 1: Test que falla (mapeo kind→sourceType/incomeType)**

```typescript
import { resolveManualIncomeCost } from './manual-income.util';

describe('resolveManualIncomeCost', () => {
  it('recoleccion → collection', () => {
    expect(resolveManualIncomeCost('recoleccion', { cost: 120 })).toEqual({ cost: 120, sourceType: 'collection', incomeType: 'entregado' });
  });
  it('pod → shipment/entregado', () => {
    expect(resolveManualIncomeCost('pod', { cost: 100 })).toEqual({ cost: 100, sourceType: 'shipment', incomeType: 'entregado' });
  });
  it('dex → 3ra visita', () => {
    expect(resolveManualIncomeCost('dex', { cost: 80 })).toEqual({ cost: 80, sourceType: 'shipment', incomeType: 'cliente_no_disponible_3ra_visita' });
  });
  it('manual → manual', () => {
    expect(resolveManualIncomeCost('manual', { cost: 50 })).toEqual({ cost: 50, sourceType: 'manual', incomeType: 'entregado' });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/manual-income.util.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar la función pura**

```typescript
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

export type ManualKind = 'recoleccion' | 'pod' | 'dex' | 'manual';

export function resolveManualIncomeCost(kind: ManualKind, overrides: { cost?: number }) {
  const cost = Number((overrides.cost ?? 0).toFixed(2));
  switch (kind) {
    case 'recoleccion': return { cost, sourceType: IncomeSourceType.COLLECTION, incomeType: IncomeStatus.ENTREGADO };
    case 'pod':         return { cost, sourceType: IncomeSourceType.SHIPMENT,   incomeType: IncomeStatus.ENTREGADO };
    case 'dex':         return { cost, sourceType: IncomeSourceType.SHIPMENT,   incomeType: IncomeStatus.CLIENTE_NO_DISPONIBLE_3RA_VISITA };
    case 'manual':      return { cost, sourceType: IncomeSourceType.MANUAL,     incomeType: IncomeStatus.ENTREGADO };
  }
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/manual-income.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: DTO + createManual + guard anti-duplicado**

`create-manual-income.dto.ts`:

```typescript
import { IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
export class CreateManualIncomeDto {
  @IsString() subsidiaryId: string;
  @IsIn(['recoleccion','pod','dex','manual']) kind: 'recoleccion'|'pod'|'dex'|'manual';
  @IsOptional() @IsString() trackingNumber?: string;
  @IsNumber() @Min(0) cost: number;
  @IsString() date: string;           // YYYY-MM-DD (día de la operación, dentro de la semana)
  @IsString() @MinLength(3) reason: string;
}
```

En `ConsolidadorIncomeService.createManual`: resolver `{sourceType,incomeType}` con `resolveManualIncomeCost`, chequear duplicado (`incomeRepo.findOne` por `subsidiaryId`+`trackingNumber`+mismo día+`incomeType`), y si existe lanzar `ConflictException('Ya existe un ingreso equivalente ese día')`. Crear el `Income` con `subsidiary:{id}`, `shipmentType` por defecto del repo (revisar el default usado en collection income; probablemente `ShipmentType.CARGA`/`NORMAL` — usar el mismo que el flujo automático de collection), `date` a instante local del día, `createdById: userId`, `editReason: reason`. Guardar y retornar `mapIncomeToRow`.

- [ ] **Step 6: Endpoint POST**

```typescript
@Post('income')
createManual(@Body() dto: CreateManualIncomeDto, @Req() req: any) {
  return this.income.createManual(dto, req.user?.id);
}
```

- [ ] **Step 7: Correr suite + compilar**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador && npx tsc --noEmit`
Expected: PASS + sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/consolidador
git commit -m "feat(consolidador): alta manual de ingresos (recolección/POD/DEX/manual) + anti-duplicado"
```

---

### Task 10: FE — dialog "Agregar ingreso"

**Files:**
- Create: `components/consolidador/add-income-dialog.tsx`
- Modify: `lib/services/consolidador.ts` (`createManualIncome`)
- Modify: `app/finanzas/consolidador/page.tsx` (botón + handler)
- Test: `components/consolidador/add-income-dialog.test.tsx`

**Interfaces:**
- Produces: `createManualIncome(payload): Promise<ConsolidadorRow>`; dialog controlado que valida `kind`, `cost>=0`, `reason`, `date` dentro de `[from,to]`.

- [ ] **Step 1: Servicio**

```typescript
export const createManualIncome = async (payload: {
  subsidiaryId: string; kind: 'recoleccion'|'pod'|'dex'|'manual';
  trackingNumber?: string; cost: number; date: string; reason: string;
}) => (await axiosConfig.post(`${baseUrl}/income`, payload)).data;
```

- [ ] **Step 2: Test del dialog**

`add-income-dialog.test.tsx` — Guardar deshabilitado si falta `reason` o `date` fuera de la semana; con datos válidos llama `onSubmit` con el payload correcto (incluye `kind`).

- [ ] **Step 3: Correr y ver que falla**

Run: `cd C:/PMY/app-pmy && npx vitest run components/consolidador/add-income-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implementar el dialog**

`Dialog` con `Select` de tipo (Recolección/POD/DEX/Manual), `Input` tracking (opcional), `Input` monto, `Input type=date` acotado a `[from,to]`, `Textarea` motivo. Props `{ open, onOpenChange, subsidiaryId, week:{from,to}, onSubmit }`.

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd C:/PMY/app-pmy && npx vitest run components/consolidador/add-income-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Cablear en la página**

Botón "Agregar ingreso" en `OperationHeader` actions o toolbar; handler llama `createManualIncome`, `mutate()`, `toast`. Manejar `409` (duplicado) con toast claro.

- [ ] **Step 7: Verificar en navegador**

Preview: agregar una recolección; aparece en la tabla y suma al KPI Recolecciones. Screenshot.

- [ ] **Step 8: Commit**

```bash
git add components/consolidador lib/services/consolidador.ts app/finanzas/consolidador
git commit -m "feat(consolidador): FE alta manual de ingresos"
```

---

## FASE F3 — Corregir estatus contra FedEx

### Task 11: `deriveStatusCorrection` (puro) + test

**Files:**
- Create: `src/consolidador/logic/status-correction.util.ts`
- Test: `src/consolidador/logic/status-correction.util.spec.ts`

**Interfaces:**
- Produces:
  - `type IncomeEffect = { kind: 'none' } | { kind: 'reclassify'; incomeType: IncomeStatus } | { kind: 'setCost'; cost: number } | { kind: 'deactivate' }`
  - `deriveStatusCorrection(current: ShipmentStatusType|null, fedex: ShipmentStatusType|null): { newStatus: ShipmentStatusType|null; incomeEffect: IncomeEffect }`
  - Regla v1 acotada: si `fedex==null` o `fedex===current` → `newStatus=current`, `incomeEffect={kind:'none'}`. Si `fedex===ENTREGADO` y `current!==ENTREGADO` → `newStatus=ENTREGADO`, `incomeEffect={kind:'reclassify', incomeType: ENTREGADO}`. Si `fedex` es no-entregado terminal (`RECHAZADO`/`DEVUELTO_A_FEDEX`) → `newStatus=fedex`, `incomeEffect={kind:'reclassify', incomeType: NO_ENTREGADO}`. Otro → `newStatus=fedex`, `incomeEffect={kind:'none'}` (solo corrige estatus, no dinero).

- [ ] **Step 1: Test que falla**

```typescript
import { deriveStatusCorrection } from './status-correction.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

describe('deriveStatusCorrection', () => {
  it('sin diff → none', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA))
      .toEqual({ newStatus: ShipmentStatusType.EN_RUTA, incomeEffect: { kind: 'none' } });
  });
  it('fedex entregado y interno no → reclasifica a entregado', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.ENTREGADO))
      .toEqual({ newStatus: ShipmentStatusType.ENTREGADO, incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.ENTREGADO } });
  });
  it('fedex sin dato → no toca', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, null))
      .toEqual({ newStatus: ShipmentStatusType.EN_RUTA, incomeEffect: { kind: 'none' } });
  });
  it('devuelto a fedex → reclasifica income a no_entregado', () => {
    expect(deriveStatusCorrection(ShipmentStatusType.EN_RUTA, ShipmentStatusType.DEVUELTO_A_FEDEX))
      .toEqual({ newStatus: ShipmentStatusType.DEVUELTO_A_FEDEX, incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.NO_ENTREGADO } });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/status-correction.util.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

export type IncomeEffect =
  | { kind: 'none' }
  | { kind: 'reclassify'; incomeType: IncomeStatus }
  | { kind: 'setCost'; cost: number }
  | { kind: 'deactivate' };

const NO_ENTREGADO_TERMINAL = [ShipmentStatusType.RECHAZADO, ShipmentStatusType.DEVUELTO_A_FEDEX];

export function deriveStatusCorrection(
  current: ShipmentStatusType | null,
  fedex: ShipmentStatusType | null,
): { newStatus: ShipmentStatusType | null; incomeEffect: IncomeEffect } {
  if (!fedex || fedex === current) return { newStatus: current, incomeEffect: { kind: 'none' } };
  if (fedex === ShipmentStatusType.ENTREGADO) {
    return { newStatus: fedex, incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.ENTREGADO } };
  }
  if (NO_ENTREGADO_TERMINAL.includes(fedex)) {
    return { newStatus: fedex, incomeEffect: { kind: 'reclassify', incomeType: IncomeStatus.NO_ENTREGADO } };
  }
  return { newStatus: fedex, incomeEffect: { kind: 'none' } };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/logic/status-correction.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consolidador/logic/status-correction.util.*
git commit -m "feat(consolidador): deriveStatusCorrection puro + test"
```

---

### Task 12: Status service (búsqueda + FedEx + aplicar) + endpoints

**Files:**
- Create: `src/consolidador/status/consolidador-status.service.ts`
- Create: `src/consolidador/dto/fix-status.dto.ts`
- Modify: `src/consolidador/consolidador.controller.ts` (GET `/package/:tracking`, PATCH `/package/:shipmentId/status`)
- Modify: `src/consolidador/consolidador.module.ts` (importar `FedexStatusModule`, agregar provider, `Shipment` ya está)
- Test: `src/consolidador/status/consolidador-status.service.spec.ts`

**Interfaces:**
- Consumes: `FedexStatusResolver.getLatestStatus` (retorna `LatestStatusResult` con `.status: ShipmentStatusType|null`, `.found`, `.error`), `deriveStatusCorrection` (Task 11), repos `Shipment`, `Income`.
- Produces:
  - `ConsolidadorStatusService.search(tracking: string): Promise<{ shipment: {id,status}|null; internalStatus: ShipmentStatusType|null; fedex: LatestStatusResult; income: ConsolidadorRow|null }>`
  - `ConsolidadorStatusService.fixStatus(shipmentId: string, newStatus: ShipmentStatusType, reason: string, userId: string): Promise<{ shipmentStatus: ShipmentStatusType; income: ConsolidadorRow|null }>`

- [ ] **Step 1: Verificar el módulo de FedEx exporta el resolver**

`FedexStatusModule` ya exporta `FedexStatusResolver` (ver `fedex-status.module.ts`). Se importará en `ConsolidadorModule`.

- [ ] **Step 2: Test que falla (search compone interno vs fedex)**

```typescript
import { ConsolidadorStatusService } from './consolidador-status.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

const resolver: any = { getLatestStatus: async () => ({ found: true, status: ShipmentStatusType.ENTREGADO, error: undefined }) };
const shipmentRepo: any = { findOne: async () => ({ id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA }) };
const incomeRepo: any = { findOne: async () => null };

describe('ConsolidadorStatusService.search', () => {
  it('devuelve estatus interno y de FedEx', async () => {
    const svc = new ConsolidadorStatusService(shipmentRepo, incomeRepo, resolver);
    const r = await svc.search('T1');
    expect(r.internalStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(r.fedex.status).toBe(ShipmentStatusType.ENTREGADO);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador/status/consolidador-status.service.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar el servicio**

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { Income } from 'src/entities/income.entity';
import { FedexStatusResolver } from 'src/fedex-status/fedex-status.resolver';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { deriveStatusCorrection } from '../logic/status-correction.util';
import { mapIncomeToRow } from '../read/consolidador-row.mapper';

@Injectable()
export class ConsolidadorStatusService {
  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    private readonly resolver: FedexStatusResolver,
  ) {}

  async search(tracking: string) {
    const shipment = await this.shipmentRepo.findOne({ where: { trackingNumber: tracking } });
    const fedex = await this.resolver.getLatestStatus(tracking);
    const income = shipment
      ? await this.incomeRepo.findOne({ where: { shipment: { id: shipment.id } }, relations: ['shipment', 'charge'] })
      : null;
    return {
      shipment: shipment ? { id: shipment.id, status: shipment.status } : null,
      internalStatus: shipment?.status ?? null,
      fedex,
      income: income ? mapIncomeToRow(income) : null,
    };
  }

  async fixStatus(shipmentId: string, newStatus: ShipmentStatusType, reason: string, userId: string) {
    const shipment = await this.shipmentRepo.findOne({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Shipment no encontrado');
    // Verifica contra FedEx: no permitimos corregir si FedEx no confirma el nuevo estatus.
    const fedex = await this.resolver.getLatestStatus(shipment.trackingNumber);
    if (!fedex.found || fedex.error) throw new BadRequestException('No se pudo verificar el estatus contra FedEx');
    const { newStatus: resolved, incomeEffect } = deriveStatusCorrection(shipment.status, fedex.status);
    if (resolved && resolved === newStatus) {
      shipment.status = resolved;                 // escribe SHIPMENT
      await this.shipmentRepo.save(shipment);
    } else {
      throw new BadRequestException('El estatus solicitado no coincide con FedEx');
    }
    // Ajusta el income ligado según el efecto acotado.
    let incomeRow = null;
    const income = await this.incomeRepo.findOne({ where: { shipment: { id: shipment.id } }, relations: ['shipment', 'charge'] });
    if (income && incomeEffect.kind === 'reclassify') {
      income.incomeType = incomeEffect.incomeType;
      income.updatedById = userId; income.updatedAt = new Date(); income.editReason = reason;
      await this.incomeRepo.save(income);
    }
    if (income) incomeRow = mapIncomeToRow(income);
    return { shipmentStatus: shipment.status, income: incomeRow };
  }
}
```

`fix-status.dto.ts`:

```typescript
import { IsEnum, IsString, MinLength } from 'class-validator';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
export class FixStatusDto {
  @IsEnum(ShipmentStatusType) newStatus: ShipmentStatusType;
  @IsString() @MinLength(3) reason: string;
}
```

- [ ] **Step 5: Endpoints**

```typescript
@Get('package/:tracking')
searchPackage(@Param('tracking') tracking: string) { return this.status.search(tracking); }

@Patch('package/:shipmentId/status')
fixStatus(@Param('shipmentId') id: string, @Body() dto: FixStatusDto, @Req() req: any) {
  return this.status.fixStatus(id, dto.newStatus, dto.reason, req.user?.id);
}
```

Módulo: `imports: [..., FedexStatusModule]`, `providers: [..., ConsolidadorStatusService]`.

- [ ] **Step 6: Correr suite + compilar**

Run: `cd C:/PMY/pmy-api && npx jest src/consolidador && npx tsc --noEmit`
Expected: PASS + sin errores TS.

- [ ] **Step 7: Commit**

```bash
git add src/consolidador
git commit -m "feat(consolidador): búsqueda de paquete + corrección de estatus contra FedEx (escribe shipment + ajusta income)"
```

---

### Task 13: FE — dialog buscar paquete + corregir estatus

**Files:**
- Create: `components/consolidador/search-package-dialog.tsx`
- Modify: `lib/services/consolidador.ts` (`searchPackage`, `fixPackageStatus`)
- Modify: `app/finanzas/consolidador/page.tsx` (botón "Buscar paquete")
- Test: `components/consolidador/search-package-dialog.test.tsx`

**Interfaces:**
- Produces: `searchPackage(tracking)`, `fixPackageStatus(shipmentId, newStatus, reason)`; dialog que muestra interno vs FedEx y habilita "Corregir" solo si `fedex.found && !fedex.error && fedex.status !== internalStatus`.

- [ ] **Step 1: Servicio**

```typescript
export const searchPackage = async (tracking: string) =>
  (await axiosConfig.get(`${baseUrl}/package/${encodeURIComponent(tracking)}`)).data;
export const fixPackageStatus = async (shipmentId: string, newStatus: string, reason: string) =>
  (await axiosConfig.patch(`${baseUrl}/package/${shipmentId}/status`, { newStatus, reason })).data;
```

- [ ] **Step 2: Test del dialog**

`search-package-dialog.test.tsx` — dado un resultado con `internalStatus='en_ruta'` y `fedex.status='entregado'`, se muestran ambos `Badge` y el botón "Corregir" está habilitado; con `fedex.found=false` el botón está deshabilitado y se muestra "no se pudo verificar".

- [ ] **Step 3: Correr y ver que falla**

Run: `cd C:/PMY/app-pmy && npx vitest run components/consolidador/search-package-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implementar el dialog**

`Dialog` con `Input` de tracking + botón Buscar (llama `searchPackage`), muestra dos `Badge` (Interno / FedEx) lado a lado, el `income` ligado si existe, `Textarea` motivo, y botón "Corregir estatus" (llama `fixPackageStatus`) habilitado solo si hay diff y FedEx confirmó. Estados de loading/errores con `toast`.

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd C:/PMY/app-pmy && npx vitest run components/consolidador/search-package-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Cablear en la página + mutate**

Botón "Buscar paquete" en el header; al corregir, `toast` y `mutate()` de la semana (por si el income ligado cae en el rango visible).

- [ ] **Step 7: Verificar en navegador**

Preview: buscar una guía real con diff conocido, ver interno vs FedEx, corregir, confirmar que `shipment.status` cambió (re-buscar) y el income refleja el efecto. Screenshot.

- [ ] **Step 8: Commit**

```bash
git add components/consolidador lib/services/consolidador.ts app/finanzas/consolidador
git commit -m "feat(consolidador): FE buscar paquete + corregir estatus contra FedEx"
```

---

## Self-Review (cobertura vs spec)

- §4 Migración → Task 1. ✅
- §5.1 Endpoints: GET semana → Task 3; PATCH cost/second-abord → Task 7; POST manual → Task 9; GET package + PATCH status → Task 12. ✅
- §5.2 Agregación (semana, buckets, filtros) → Task 2 (semana) + Task 3 (buckets/filtros). ✅
- §5.3 Funciones puras → Task 6 (`computeSecondAbordDelta`), Task 9 (`resolveManualIncomeCost`), Task 11 (`deriveStatusCorrection`). ✅
- §6 FE (página, toolbar, KPIs, tabla, dialogs) → Tasks 4,5,8,10,13. ✅
- §7 Errores (cost≥0, reason, FedEx falla bloquea, anti-duplicado) → DTOs Tasks 7/9/12 + guard Task 3 + createManual Task 9 + fixStatus Task 12. ✅
- §8 Pruebas (Jest puros+servicios; Vitest FE) → cada task incluye su prueba. ✅
- §9 Fases F0–F3 → Tasks agrupadas por fase. ✅
- §10 YAGNI → sin aprobaciones, sin reversa, sin export nuevo, sin acoplar tracking-sync. ✅
- §11 Coexistencia → módulos nuevos, `income`/`ingresos`/devoluciones/tracking-sync intactos. ✅

**Notas de implementación pendientes de confirmar con el código real (marcadas inline):** nombre de la relación ruta↔shipment (`package_dispatch`) para el filtro de ruta (Task 3); heurística `alreadyIncluded` del 2º a bordo (Task 7); `shipmentType` default para alta manual de collection (Task 9); decorator/forma de obtener `req.user.id` en los controllers.
