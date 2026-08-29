# Import Jobs (Pegar FedEx) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nueva herramienta asíncrona por *job* para el "Pegar FedEx" (envíos `master` y carga/F2/31.5 `charge`) que inserta de forma robusta, sin tocar el wizard ni el código existente.

**Architecture:** Endpoints nuevos reciben las **filas ya mapeadas** por el FE (JSON), crean una fila `import_job` (MySQL) y responden al instante. Un `@Cron` poller reclama el job (claim-token) y lo procesa en **lotes cortos con commit parcial**: `master` inserta envíos `PENDIENTE` (el cron de enriquecimiento existente pone estatus/historial/ingreso después) + marca Alto Valor; `charge` inserta cargas + aplica cobros. Todo vive **inline** en `src/shipments/` (archivos nuevos) y en `src/entities/` + una migración.

**Tech Stack:** NestJS 10, TypeORM 0.3 + **mysql2** (`synchronize:false`), `@nestjs/schedule` (`@Cron`), Jest 29, `xlsx`, `p-limit` (ya presentes).

## Global Constraints

- **No tocar** `/shipments/upload`, `/shipments/upload-charge`, `addConsMasterBySubsidiary`, `processFileF2`, `processShipment`, ni el wizard. Solo altas aditivas en `shipments.module.ts` y `src/entities/index.ts`.
- **Esquema por migración** (`synchronize:false` en todos los entornos). Migración con guard defensivo a `information_schema`, identificadores en backticks, `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, `varchar(36)` para ids.
- **El import NO llama a FedEx.** El enriquecimiento (estatus/historial/ingreso) lo hace el cron existente `processMasterFedexUpdate` sobre los `PENDIENTE`.
- **Entrada = filas canónicas** (§5.5 del spec), ya mapeadas por `app-pmy/lib/fedex-header-map.ts`. `parsePastedRows` valida/normaliza, **no** re-mapea columnas.
- Autorización: permiso `operaciones.pegarFedex`.
- Defaults: poller 5s / N=3; lote 100 filas; idempotencia 30 min; colgado heartbeat>5min, attempts>=3 → failed.

**Spec:** `docs/superpowers/specs/2026-08-29-import-jobs-design.md`

---

## File Structure

- Create `src/shipments/import-jobs.types.ts` — tipos canónicos + shapes de resultado (sin deps).
- Create `src/shipments/import-jobs.util.ts` — puro: `normalizeTracking`, `parsePastedRows`, `classifyMasterRows`, `hashRows`.
- Create `src/shipments/import-jobs.util.spec.ts`.
- Create `src/entities/import-job.entity.ts` — entidad `ImportJob`.
- Create `src/database/migrations/1786000000061-AddImportJobTable.ts`.
- Create `src/shipments/import-jobs.dto.ts` — DTOs de request.
- Create `src/shipments/import-jobs.service.ts` — create/preview/query + estrategias `master`/`charge` + sub-pasos HV/cobros + claim/recover helpers.
- Create `src/shipments/import-jobs.service.spec.ts`.
- Create `src/shipments/import-jobs.worker.ts` — `@Cron` poller.
- Create `src/shipments/import-jobs.worker.spec.ts`.
- Create `src/shipments/import-jobs.controller.ts` — endpoints.
- Modify `src/entities/index.ts` — `export * from './import-job.entity';`.
- Modify `src/shipments/shipments.module.ts` — registrar entidad, controller, providers.

---

## Task 1: Tipos canónicos + utilidades puras

**Files:**
- Create: `src/shipments/import-jobs.types.ts`
- Create: `src/shipments/import-jobs.util.ts`
- Test: `src/shipments/import-jobs.util.spec.ts`

**Interfaces:**
- Produces:
  - `CanonicalRow` (interface, ver abajo).
  - `ImportJobKind = 'master' | 'charge'`.
  - `normalizeTracking(v: unknown): string`
  - `parsePastedRows(rows: unknown, kind: ImportJobKind): { rows: CanonicalRow[]; totalRows: number }` — lanza `BadRequestException` si no hay filas válidas.
  - `classifyMasterRows(rows: CanonicalRow[], existing: Map<string, { consolidatedId: string | null; status: string }>, targetConsId: string, returnStatuses: string[]): { toInsert: CanonicalRow[]; duplicated: CanonicalRow[]; recycledTrackings: string[]; toMarkReturned: string[] }`
  - `hashRows(rows: CanonicalRow[]): string` — sha256 estable.

- [ ] **Step 1: Write the failing test**

`src/shipments/import-jobs.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { normalizeTracking, parsePastedRows, classifyMasterRows, hashRows } from './import-jobs.util';
import { CanonicalRow } from './import-jobs.types';

describe('import-jobs.util', () => {
  describe('normalizeTracking', () => {
    it('limpia float .0, notación científica y separadores', () => {
      expect(normalizeTracking('383012036065.0')).toBe('383012036065');
      expect(normalizeTracking('3830 1203 6065')).toBe('383012036065');
      expect(normalizeTracking(' 794000112233 ')).toBe('794000112233');
    });
    it('no toca ids alfanuméricos (DHL)', () => {
      expect(normalizeTracking('JD0123ABC')).toBe('JD0123ABC');
    });
  });

  describe('parsePastedRows', () => {
    it('normaliza guía, hace trim y omite filas sin guía', () => {
      const out = parsePastedRows(
        [
          { trackingNumber: '383012036065.0', recipientName: '  Juan  ', cod: 'COD 1250.00' },
          { trackingNumber: '', recipientName: 'sin guia' },
        ],
        'master',
      );
      expect(out.totalRows).toBe(1);
      expect(out.rows[0].trackingNumber).toBe('383012036065');
      expect(out.rows[0].recipientName).toBe('Juan');
      expect(out.rows[0].cod).toBe('COD 1250.00');
    });
    it('lanza 400 si no hay filas con guía', () => {
      expect(() => parsePastedRows([{ trackingNumber: '' }], 'master')).toThrow(BadRequestException);
      expect(() => parsePastedRows([], 'master')).toThrow(BadRequestException);
      expect(() => parsePastedRows(null, 'master')).toThrow(BadRequestException);
    });
  });

  describe('classifyMasterRows', () => {
    const RET = ['devuelto_a_fedex'];
    const rows: CanonicalRow[] = [
      { trackingNumber: 'A' }, // nueva
      { trackingNumber: 'B' }, // duplicada en este cons
      { trackingNumber: 'C' }, // reingreso desde otro cons (no devuelta)
      { trackingNumber: 'D' }, // reingreso ya devuelto
    ];
    const existing = new Map<string, { consolidatedId: string | null; status: string }>([
      ['B', { consolidatedId: 'CONS1', status: 'pendiente' }],
      ['C', { consolidatedId: 'CONS0', status: 'pendiente' }],
      ['D', { consolidatedId: 'CONS0', status: 'devuelto_a_fedex' }],
    ]);
    it('separa nuevas, duplicadas y reingresos', () => {
      const r = classifyMasterRows(rows, existing, 'CONS1', RET);
      expect(r.toInsert.map((x) => x.trackingNumber).sort()).toEqual(['A', 'C', 'D']);
      expect(r.duplicated.map((x) => x.trackingNumber)).toEqual(['B']);
      expect(r.recycledTrackings.sort()).toEqual(['C', 'D']);
      expect(r.toMarkReturned).toEqual(['C']); // D ya estaba devuelta → no re-marcar
    });
  });

  describe('hashRows', () => {
    it('es estable ante reordenamiento de claves', () => {
      const a = hashRows([{ trackingNumber: 'A', cod: 'COD 10' } as CanonicalRow]);
      const b = hashRows([{ cod: 'COD 10', trackingNumber: 'A' } as CanonicalRow]);
      expect(a).toBe(b);
    });
    it('cambia si cambian los datos', () => {
      expect(hashRows([{ trackingNumber: 'A' } as CanonicalRow]))
        .not.toBe(hashRows([{ trackingNumber: 'B' } as CanonicalRow]));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shipments/import-jobs.util.spec.ts`
Expected: FAIL (módulos no existen).

- [ ] **Step 3: Write the types**

`src/shipments/import-jobs.types.ts`:

```ts
export type ImportJobKind = 'master' | 'charge';

/** Fila canónica ya mapeada por el FE (espejo de table.rows[].values + isHighValue). */
export interface CanonicalRow {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientCity?: string;
  recipientZip?: string;
  commitDate?: string;
  commitTime?: string;
  recipientPhone?: string;
  cod?: string;
  isHighValue?: boolean;
}

export interface ImportJobResult {
  failedTrackings: { trackingNumber: string; reason: string }[];
  duplicatedTrackings: string[];
  cobrosUnmatchedTrackings: string[];
  summary: Record<string, number>;
}
```

- [ ] **Step 4: Write the util**

`src/shipments/import-jobs.util.ts`:

```ts
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { CanonicalRow, ImportJobKind } from './import-jobs.types';

const CANONICAL_KEYS: (keyof CanonicalRow)[] = [
  'trackingNumber', 'recipientName', 'recipientAddress', 'recipientCity',
  'recipientZip', 'commitDate', 'commitTime', 'recipientPhone', 'cod', 'isHighValue',
];

/** Limpia guías que llegan como número de Excel; no toca ids alfanuméricos (DHL). */
export function normalizeTracking(v: unknown): string {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
  if (/^\d(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = n.toLocaleString('fullwide', { useGrouping: false });
  }
  const stripped = s.replace(/[\s-]/g, '');
  if (/^\d+$/.test(stripped)) s = stripped;
  return s;
}

/** Valida y normaliza filas canónicas del FE. NO re-mapea columnas. */
export function parsePastedRows(rows: unknown, _kind: ImportJobKind): { rows: CanonicalRow[]; totalRows: number } {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BadRequestException('El pegado no contiene filas.');
  }
  const out: CanonicalRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw as Record<string, unknown>;
    const trackingNumber = normalizeTracking(src.trackingNumber);
    if (!trackingNumber) continue; // fila sin guía se omite (no aborta)
    const row: CanonicalRow = { trackingNumber };
    for (const k of CANONICAL_KEYS) {
      if (k === 'trackingNumber') continue;
      if (k === 'isHighValue') { if (src.isHighValue === true) row.isHighValue = true; continue; }
      const val = src[k];
      if (val !== undefined && val !== null) row[k] = String(val).trim() as never;
    }
    out.push(row);
  }
  if (out.length === 0) throw new BadRequestException('Ninguna fila del pegado tiene guía válida.');
  return { rows: out, totalRows: out.length };
}

/** Clasifica guías nuevas / duplicadas / reingresos. Espejo de addConsMasterBySubsidiary. */
export function classifyMasterRows(
  rows: CanonicalRow[],
  existing: Map<string, { consolidatedId: string | null; status: string }>,
  targetConsId: string,
  returnStatuses: string[],
): { toInsert: CanonicalRow[]; duplicated: CanonicalRow[]; recycledTrackings: string[]; toMarkReturned: string[] } {
  const toInsert: CanonicalRow[] = [];
  const duplicated: CanonicalRow[] = [];
  const recycledTrackings: string[] = [];
  const toMarkReturned: string[] = [];
  const returns = returnStatuses.map((s) => s.toLowerCase());
  const seen = new Set<string>();

  for (const row of rows) {
    const tn = row.trackingNumber;
    if (seen.has(tn)) { duplicated.push(row); continue; } // duplicada dentro del pegado
    seen.add(tn);
    const prev = existing.get(tn);
    if (!prev) { toInsert.push(row); continue; } // nueva
    if (prev.consolidatedId === targetConsId) { duplicated.push(row); continue; } // ya en este cons
    // reingreso desde otro cons
    toInsert.push(row);
    recycledTrackings.push(tn);
    if (!returns.includes((prev.status || '').toLowerCase())) toMarkReturned.push(tn);
  }
  return { toInsert, duplicated, recycledTrackings, toMarkReturned };
}

/** Hash estable del payload (claves ordenadas) para idempotencia. */
export function hashRows(rows: CanonicalRow[]): string {
  const norm = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of [...CANONICAL_KEYS].sort()) if (r[k] !== undefined) o[k] = r[k];
    return o;
  });
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/shipments/import-jobs.util.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shipments/import-jobs.types.ts src/shipments/import-jobs.util.ts src/shipments/import-jobs.util.spec.ts
git commit -m "feat(import-jobs): tipos canónicos y utilidades puras (parse/classify/hash)"
```

---

## Task 2: Entidad ImportJob + migración + registro

**Files:**
- Create: `src/entities/import-job.entity.ts`
- Create: `src/database/migrations/1786000000061-AddImportJobTable.ts`
- Modify: `src/entities/index.ts` (agregar export)
- Modify: `src/shipments/shipments.module.ts` (registrar entidad)

**Interfaces:**
- Produces: clase `ImportJob` con columnas del §5.1 del spec. `ImportJobStatus = 'pending' | 'processing' | 'done' | 'partial' | 'failed'`.

- [ ] **Step 1: Write the entity**

`src/entities/import-job.entity.ts`:

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ImportJobStatus = 'pending' | 'processing' | 'done' | 'partial' | 'failed';
export type ImportJobKind = 'master' | 'charge';
export type ImportJobSource = 'paste' | 'retry';

@Entity('import_job')
@Index('IDX_import_job_status_created', ['status', 'createdAt'])
@Index('IDX_import_job_idem', ['subsidiaryId', 'kind', 'consNumber', 'payloadHash', 'createdAt'])
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: ImportJobKind;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ImportJobStatus;

  @Column({ type: 'varchar', length: 16, default: 'paste' })
  source: ImportJobSource;

  @Column({ type: 'varchar', length: 36 })
  subsidiaryId: string;

  @Column({ type: 'varchar', length: 255 })
  consNumber: string;

  @Column({ type: 'datetime', nullable: true })
  consDate: Date | null;

  @Column({ type: 'boolean', default: false })
  isAereo: boolean;

  @Column({ type: 'boolean', default: false })
  isHalfTon: boolean;

  @Column({ type: 'boolean', default: false })
  notRemoveCharge: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 64 })
  payloadHash: string;

  @Column({ type: 'longtext' })
  payloadRows: string; // JSON.stringify(CanonicalRow[])

  @Column({ type: 'longtext', nullable: true })
  onlyTrackings: string | null; // JSON.stringify(string[])

  @Column({ type: 'varchar', length: 36, nullable: true })
  parentJobId: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  claimToken: string | null;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  processedRows: number;

  @Column({ type: 'int', default: 0 })
  saved: number;

  @Column({ type: 'int', default: 0 })
  duplicated: number;

  @Column({ type: 'int', default: 0 })
  recycled: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ type: 'int', default: 0 })
  hvMarked: number;

  @Column({ type: 'int', default: 0 })
  cobrosApplied: number;

  @Column({ type: 'int', default: 0 })
  cobrosUnmatched: number;

  @Column({ type: 'longtext', nullable: true })
  result: string | null; // JSON.stringify(ImportJobResult)

  @Column({ type: 'varchar', length: 36, nullable: true })
  consolidatedId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'datetime', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdById: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
```

- [ ] **Step 2: Write the migration** (mismo estilo que `1786000000055-AddImportFileTable.ts`)

`src/database/migrations/1786000000061-AddImportJobTable.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabla `import_job`: cola de importaciones por *paste* (envíos y cargas). */
export class AddImportJobTable1786000000061 implements MigrationInterface {
  name = 'AddImportJobTable1786000000061';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_job')) return;
    await queryRunner.query(`
      CREATE TABLE \`import_job\` (
        \`id\` varchar(36) NOT NULL,
        \`kind\` varchar(16) NOT NULL,
        \`status\` varchar(16) NOT NULL DEFAULT 'pending',
        \`source\` varchar(16) NOT NULL DEFAULT 'paste',
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`consNumber\` varchar(255) NOT NULL,
        \`consDate\` datetime NULL,
        \`isAereo\` tinyint NOT NULL DEFAULT 0,
        \`isHalfTon\` tinyint NOT NULL DEFAULT 0,
        \`notRemoveCharge\` tinyint NOT NULL DEFAULT 0,
        \`label\` varchar(255) NULL,
        \`payloadHash\` varchar(64) NOT NULL,
        \`payloadRows\` longtext NOT NULL,
        \`onlyTrackings\` longtext NULL,
        \`parentJobId\` varchar(36) NULL,
        \`claimToken\` varchar(36) NULL,
        \`totalRows\` int NOT NULL DEFAULT 0,
        \`processedRows\` int NOT NULL DEFAULT 0,
        \`saved\` int NOT NULL DEFAULT 0,
        \`duplicated\` int NOT NULL DEFAULT 0,
        \`recycled\` int NOT NULL DEFAULT 0,
        \`failed\` int NOT NULL DEFAULT 0,
        \`hvMarked\` int NOT NULL DEFAULT 0,
        \`cobrosApplied\` int NOT NULL DEFAULT 0,
        \`cobrosUnmatched\` int NOT NULL DEFAULT 0,
        \`result\` longtext NULL,
        \`consolidatedId\` varchar(36) NULL,
        \`error\` text NULL,
        \`attempts\` int NOT NULL DEFAULT 0,
        \`claimedAt\` datetime NULL,
        \`startedAt\` datetime NULL,
        \`heartbeatAt\` datetime NULL,
        \`finishedAt\` datetime NULL,
        \`createdById\` varchar(36) NULL,
        \`createdByName\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_import_job_status_created\` (\`status\`, \`createdAt\`),
        KEY \`IDX_import_job_idem\` (\`subsidiaryId\`, \`kind\`, \`consNumber\`, \`payloadHash\`, \`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_job')) {
      await queryRunner.query(`DROP TABLE \`import_job\``);
    }
  }
}
```

- [ ] **Step 3: Register entity export**

En `src/entities/index.ts`, agregar al final:

```ts
export * from './import-job.entity';
```

- [ ] **Step 4: Register entity in module**

En `src/shipments/shipments.module.ts`, agregar `ImportJob` al `forFeature` (import desde `src/entities`):

```ts
// import { ..., ImportJob } from 'src/entities';
imports: [TypeOrmModule.forFeature([Shipment, ShipmentStatus, Subsidiary, Income, Charge, ChargeShipment, Consolidated, ForPickUp, PackageDispatch, Unloading, ImportJob]), TrackingModule, DocumentsModule, HolidaysModule, ImportFilesModule],
```
(Quitar el `Consolidated` duplicado existente de paso.)

- [ ] **Step 5: Build + run migration on dev DB**

Run: `npm run build`
Expected: compila sin errores.
Run: `npm run migration:run`
Expected: crea `import_job` (o no-op si ya existe). Verificar: `SHOW TABLES LIKE 'import_job';` devuelve la tabla.

- [ ] **Step 6: Commit**

```bash
git add src/entities/import-job.entity.ts src/entities/index.ts src/database/migrations/1786000000061-AddImportJobTable.ts src/shipments/shipments.module.ts
git commit -m "feat(import-jobs): entidad ImportJob + migración 061 + registro en módulo"
```

---

## Task 3: DTOs + creación de job con idempotencia + preview

**Files:**
- Create: `src/shipments/import-jobs.dto.ts`
- Create: `src/shipments/import-jobs.service.ts` (parte: `create`, `preview`, `getById`, `list`)
- Test: `src/shipments/import-jobs.service.spec.ts`

**Interfaces:**
- Consumes: `parsePastedRows`, `hashRows` (Task 1); `ImportJob` (Task 2); `ConsolidatedService.findByConsNumberScoped` (existente).
- Produces:
  - `ImportJobsService.create(dto: CreateImportJobDto, user?: { userId?: string; name?: string }): Promise<{ jobId: string; totalRows: number; status: string; deduped: boolean }>`
  - `ImportJobsService.preview(dto: PreviewImportDto): Promise<PreviewResult>` con shape `{ withTracking, newCount, recycledCount, alreadyImportedCount, duplicatesInFile, consNumberExists: { consNumber: string; isExactMatch: boolean } | null, parseError: string | null }`
  - `ImportJobsService.getById(id)`, `ImportJobsService.list(subsidiaryId?, kind?, limit?)`

- [ ] **Step 1: Write DTOs**

`src/shipments/import-jobs.dto.ts`:

```ts
import { CanonicalRow, ImportJobKind } from './import-jobs.types';

export class CreateImportJobDto {
  kind: ImportJobKind;
  subsidiaryId: string;
  consNumber: string;
  consDate?: string;
  isAereo?: boolean;
  isHalfTon?: boolean;
  notRemoveCharge?: boolean;
  source?: 'paste' | 'retry';
  rows: CanonicalRow[];
}

export class PreviewImportDto {
  kind: ImportJobKind;
  subsidiaryId: string;
  consNumber: string;
  consDate?: string;
  notRemoveCharge?: boolean;
  rows: CanonicalRow[];
}
```

- [ ] **Step 2: Write the failing test**

`src/shipments/import-jobs.service.spec.ts` (parte create/idempotencia — usa repos mock):

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ImportJobsService } from './import-jobs.service';
import { ImportJob } from '../entities/import-job.entity';
import { Shipment } from '../entities/shipment.entity';
import { ChargeShipment } from '../entities/charge-shipment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { HolidaysService } from 'src/holidays/holidays.service';

function repoMock(extra: any = {}) {
  return { find: jest.fn(), findOne: jest.fn(), create: jest.fn((x) => x), save: jest.fn(async (x) => x), ...extra };
}

describe('ImportJobsService.create (idempotencia)', () => {
  let service: ImportJobsService;
  let importJobRepo: any;

  beforeEach(async () => {
    importJobRepo = repoMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportJobsService,
        { provide: getRepositoryToken(ImportJob), useValue: importJobRepo },
        { provide: getRepositoryToken(Shipment), useValue: repoMock() },
        { provide: getRepositoryToken(ChargeShipment), useValue: repoMock() },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
        { provide: ConsolidatedService, useValue: { findByConsNumberScoped: jest.fn().mockResolvedValue(null) } },
        { provide: HolidaysService, useValue: { getHolidayInputs: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = moduleRef.get(ImportJobsService);
  });

  const dto = {
    kind: 'master' as const, subsidiaryId: 'S1', consNumber: 'C1',
    rows: [{ trackingNumber: '383012036065' }],
  };

  it('crea un job pending nuevo', async () => {
    importJobRepo.findOne.mockResolvedValue(null);
    importJobRepo.save.mockImplementation(async (j: any) => ({ ...j, id: 'JOB1' }));
    const res = await service.create(dto, { userId: 'U1' });
    expect(res.status).toBe('pending');
    expect(res.totalRows).toBe(1);
    expect(res.deduped).toBe(false);
    expect(importJobRepo.save).toHaveBeenCalled();
  });

  it('devuelve el job existente si hay uno reciente con el mismo hash (idempotencia)', async () => {
    importJobRepo.findOne.mockResolvedValue({ id: 'JOB0', status: 'processing', totalRows: 1 });
    const res = await service.create(dto, { userId: 'U1' });
    expect(res.jobId).toBe('JOB0');
    expect(res.deduped).toBe(true);
    expect(importJobRepo.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/shipments/import-jobs.service.spec.ts`
Expected: FAIL (servicio no existe).

- [ ] **Step 4: Write the service (create/preview/query)**

`src/shipments/import-jobs.service.ts`:

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, MoreThan } from 'typeorm';
import { ImportJob } from '../entities/import-job.entity';
import { Shipment } from '../entities/shipment.entity';
import { ChargeShipment } from '../entities/charge-shipment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { HolidaysService } from 'src/holidays/holidays.service';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { CreateImportJobDto, PreviewImportDto } from './import-jobs.dto';
import { parsePastedRows, hashRows, classifyMasterRows } from './import-jobs.util';

const IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000;
// Estatus que "cierran el ciclo" de una guía → un reingreso no re-marca.
const RETURN_STATUSES = ['devuelto_a_fedex'];

@Injectable()
export class ImportJobsService {
  private readonly logger = new Logger(ImportJobsService.name);

  constructor(
    @InjectRepository(ImportJob) private readonly jobRepo: Repository<ImportJob>,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeShipmentRepo: Repository<ChargeShipment>,
    private readonly dataSource: DataSource,
    private readonly consolidatedService: ConsolidatedService,
    private readonly holidaysService: HolidaysService,
  ) {}

  async create(dto: CreateImportJobDto, user?: { userId?: string; name?: string }) {
    const { rows, totalRows } = parsePastedRows(dto.rows, dto.kind);
    const payloadHash = hashRows(rows);

    // Idempotencia: job reciente no-fallido con mismo (sucursal, kind, cons, hash).
    const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
    const existing = await this.jobRepo.findOne({
      where: {
        subsidiaryId: dto.subsidiaryId, kind: dto.kind, consNumber: dto.consNumber,
        payloadHash, status: In(['pending', 'processing', 'done', 'partial']),
        createdAt: MoreThan(since),
      },
      order: { createdAt: 'DESC' },
    });
    if (existing) return { jobId: existing.id, totalRows: existing.totalRows, status: existing.status, deduped: true };

    const job = this.jobRepo.create({
      kind: dto.kind, status: 'pending', source: dto.source === 'retry' ? 'retry' : 'paste',
      subsidiaryId: dto.subsidiaryId, consNumber: dto.consNumber,
      consDate: dto.consDate ? new Date(dto.consDate) : null,
      isAereo: !!dto.isAereo, isHalfTon: !!dto.isHalfTon, notRemoveCharge: !!dto.notRemoveCharge,
      label: `Paste ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      payloadHash, payloadRows: JSON.stringify(rows), totalRows,
      createdById: user?.userId ?? null, createdByName: user?.name ?? null,
    });
    const saved = await this.jobRepo.save(job);
    return { jobId: saved.id, totalRows, status: 'pending', deduped: false };
  }

  async preview(dto: PreviewImportDto) {
    let rows;
    try { rows = parsePastedRows(dto.rows, dto.kind).rows; }
    catch (e: any) {
      return { withTracking: 0, newCount: 0, recycledCount: 0, alreadyImportedCount: 0, duplicatesInFile: 0, consNumberExists: null, parseError: e?.message ?? 'Pegado inválido' };
    }
    const cons = await this.consolidatedService.findByConsNumberScoped(dto.consNumber, dto.subsidiaryId, ShipmentType.FEDEX);
    const targetConsId = cons?.id ?? '__none__';
    const tns = rows.map((r) => r.trackingNumber);

    // Para charge: dedup contra charge_shipment por consNumber; para master: contra shipment por sucursal.
    const existing = new Map<string, { consolidatedId: string | null; status: string }>();
    if (dto.kind === 'master') {
      const found = tns.length ? await this.shipmentRepo.find({ where: { trackingNumber: In(tns), subsidiary: { id: dto.subsidiaryId } }, order: { createdAt: 'DESC' } }) : [];
      for (const s of found) if (!existing.has(s.trackingNumber)) existing.set(s.trackingNumber, { consolidatedId: s.consolidatedId, status: String(s.status) });
    } else {
      const found = tns.length ? await this.chargeShipmentRepo.find({ where: { trackingNumber: In(tns), consNumber: dto.consNumber } }) : [];
      for (const c of found) existing.set(c.trackingNumber, { consolidatedId: targetConsId, status: String(c.status) });
    }

    const cls = classifyMasterRows(rows, existing, targetConsId, RETURN_STATUSES);
    const duplicatesInFile = rows.length - new Set(tns).size;
    return {
      withTracking: rows.length,
      newCount: cls.toInsert.length - cls.recycledTrackings.length,
      recycledCount: dto.kind === 'master' ? cls.recycledTrackings.length : 0,
      alreadyImportedCount: cls.duplicated.length - duplicatesInFile < 0 ? 0 : cls.duplicated.length - duplicatesInFile,
      duplicatesInFile,
      consNumberExists: cons ? { consNumber: cons.consNumber, isExactMatch: true } : null,
      parseError: null,
    };
  }

  getById(id: string) {
    return this.jobRepo.findOne({ where: { id } }).then((j) => {
      if (!j) throw new NotFoundException('Job no encontrado');
      const { payloadRows, ...rest } = j as any;
      return rest;
    });
  }

  list(subsidiaryId?: string, kind?: string, limit = 25) {
    const where: any = {};
    if (subsidiaryId) where.subsidiaryId = subsidiaryId;
    if (kind) where.kind = kind;
    return this.jobRepo.find({ where, order: { createdAt: 'DESC' }, take: Math.min(limit, 100), select: {
      id: true, kind: true, status: true, subsidiaryId: true, consNumber: true, totalRows: true, saved: true,
      duplicated: true, recycled: true, failed: true, hvMarked: true, cobrosApplied: true, cobrosUnmatched: true,
      createdAt: true, finishedAt: true, createdByName: true,
    } as any });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/shipments/import-jobs.service.spec.ts`
Expected: PASS (los 2 tests de idempotencia).

- [ ] **Step 6: Commit**

```bash
git add src/shipments/import-jobs.dto.ts src/shipments/import-jobs.service.ts src/shipments/import-jobs.service.spec.ts
git commit -m "feat(import-jobs): create con idempotencia + preview + queries"
```

---

## Task 4: Estrategia `master` (insertar PENDIENTE + reingresos + Alto Valor)

**Files:**
- Modify: `src/shipments/import-jobs.service.ts` (agregar `processMasterJob`, helpers `withConsolidatedLock`, `markHighValue`)
- Test: `src/shipments/import-jobs.service.spec.ts` (agregar describe)

**Interfaces:**
- Consumes: `classifyMasterRows`, `ImportJob`, TypeORM `QueryRunner` transaction.
- Produces: `ImportJobsService.processMasterJob(job: ImportJob): Promise<void>` — muta contadores y `status` del job; commit por lote.

- [ ] **Step 1: Write the failing test** (inserta como PENDIENTE, sin FedEx; tolerancia por fila)

Agregar a `import-jobs.service.spec.ts`:

```ts
import { QueryRunner } from 'typeorm';

describe('ImportJobsService.processMasterJob', () => {
  let service: ImportJobsService;
  let saved: any[];
  let jobRepo: any;

  function makeQR(): QueryRunner {
    return {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(),
      query: jest.fn().mockResolvedValue([{ l: 1 }]), // GET_LOCK / RELEASE_LOCK
      manager: {
        findOne: jest.fn().mockResolvedValue(null),       // consolidado no existe
        find: jest.fn().mockResolvedValue([]),            // sin históricos
        create: jest.fn((_e, x) => x),
        save: jest.fn(async (_e: any, x: any) => Array.isArray(x) ? x.map((r, i) => ({ ...r, id: `id${i}` })) : { ...x, id: 'cid' }),
      },
    } as any;
  }

  beforeEach(async () => {
    saved = [];
    jobRepo = repoMock({ update: jest.fn(), save: jest.fn(async (j: any) => j) });
    const qr = makeQR();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportJobsService,
        { provide: getRepositoryToken(ImportJob), useValue: jobRepo },
        { provide: getRepositoryToken(Shipment), useValue: repoMock() },
        { provide: getRepositoryToken(ChargeShipment), useValue: repoMock() },
        { provide: DataSource, useValue: { createQueryRunner: () => qr } },
        { provide: ConsolidatedService, useValue: { findByConsNumberScoped: jest.fn().mockResolvedValue(null) } },
        { provide: HolidaysService, useValue: { getHolidayInputs: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = moduleRef.get(ImportJobsService);
    (service as any)._qr = qr;
  });

  it('inserta todas las guías como PENDIENTE (sin FedEx) y marca done', async () => {
    const job: any = {
      id: 'J', kind: 'master', subsidiaryId: 'S1', consNumber: 'C1', isAereo: true,
      payloadRows: JSON.stringify([{ trackingNumber: 'A' }, { trackingNumber: 'B', cod: 'COD 1250' }]),
      totalRows: 2, saved: 0, duplicated: 0, recycled: 0, failed: 0,
    };
    await service.processMasterJob(job);
    const qr = (service as any)._qr as any;
    const savedShipments = qr.manager.save.mock.calls.flatMap((c: any[]) => Array.isArray(c[1]) ? c[1] : []);
    const statuses = savedShipments.filter((s: any) => s.trackingNumber).map((s: any) => String(s.status).toLowerCase());
    expect(statuses.every((s: string) => s === 'pendiente')).toBe(true);
    expect(job.saved).toBe(2);
    expect(job.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shipments/import-jobs.service.spec.ts -t processMasterJob`
Expected: FAIL (`processMasterJob` no existe).

- [ ] **Step 3: Implement `processMasterJob` + helpers**

Agregar a `import-jobs.service.ts` (imports: `Consolidated`, `Subsidiary`, `ShipmentStatus`, `Payment` de `src/entities`; `ShipmentStatusType`, `Priority`, `getPriority`, `parsePaymentCell`, `ConsolidatedType`):

```ts
private readonly BATCH = 100;

/** Toma un lock nombrado de MySQL mientras corre fn (evita consolidados duplicados). */
private async withConsolidatedLock<T>(subsidiaryId: string, consNumber: string, fn: () => Promise<T>): Promise<T> {
  const key = `impcons:${subsidiaryId}:${consNumber}`;
  await this.dataSource.query('SELECT GET_LOCK(?, 10) AS l', [key]);
  try { return await fn(); }
  finally { await this.dataSource.query('SELECT RELEASE_LOCK(?) AS r', [key]); }
}

async processMasterJob(job: ImportJob): Promise<void> {
  const rows = JSON.parse(job.payloadRows) as CanonicalRow[];
  const only = job.onlyTrackings ? new Set(JSON.parse(job.onlyTrackings) as string[]) : null;
  const work = only ? rows.filter((r) => only.has(r.trackingNumber)) : rows;

  const result = { failedTrackings: [] as any[], duplicatedTrackings: [] as string[], cobrosUnmatchedTrackings: [] as string[], summary: {} as Record<string, number> };
  const tns = work.map((r) => r.trackingNumber);

  // Históricos por guía (para clasificar nueva/reingreso/duplicada).
  const existingRows = tns.length ? await this.shipmentRepo.find({ where: { trackingNumber: In(tns), subsidiary: { id: job.subsidiaryId } }, order: { createdAt: 'DESC' } }) : [];
  const existing = new Map<string, { consolidatedId: string | null; status: string; id: string }>();
  for (const s of existingRows) if (!existing.has(s.trackingNumber)) existing.set(s.trackingNumber, { consolidatedId: s.consolidatedId, status: String(s.status), id: s.id });

  await this.withConsolidatedLock(job.subsidiaryId, job.consNumber, async () => {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();

    // Consolidado find-or-create (dentro del lock).
    const { Consolidated, Subsidiary, ConsolidatedType } = require('src/entities');
    const cons = await this.consolidatedService.findByConsNumberScoped(job.consNumber, job.subsidiaryId, ShipmentType.FEDEX);
    let consolidatedId = cons?.id ?? null;
    const predefinedSub = await this.shipmentRepo.manager.findOne(Subsidiary, { where: { id: job.subsidiaryId } });
    if (!consolidatedId) {
      const created = await this.shipmentRepo.manager.save(Consolidated, this.shipmentRepo.manager.create(Consolidated, {
        date: job.consDate ?? new Date(),
        type: job.isAereo ? ConsolidatedType.AEREO : ConsolidatedType.ORDINARIA,
        numberOfPackages: 0, subsidiary: predefinedSub, consNumber: job.consNumber,
        isCompleted: false, efficiency: 0, commitDateTime: new Date(), createdById: job.createdById,
      }));
      consolidatedId = created.id;
    }
    job.consolidatedId = consolidatedId;

    const cls = classifyMasterRows(work, existing as any, consolidatedId, RETURN_STATUSES);
    result.duplicatedTrackings = cls.duplicated.map((r) => r.trackingNumber);
    job.duplicated = result.duplicatedTrackings.length;
    job.recycled = cls.recycledTrackings.length;

    const batches = this.chunk(cls.toInsert, this.BATCH);
    for (const batch of batches) {
      await qr.startTransaction();
      try {
        const { ShipmentStatus, Payment } = require('src/entities');
        const { ShipmentStatusType } = require('src/common/enums/shipment-status-type.enum');
        const { getPriority } = require('src/utils/file-upload.utils');
        const { parsePaymentCell } = require('src/utils/file-upload.utils');
        const now = new Date();
        const toSave: any[] = [];
        for (const row of batch) {
          try {
            const commit = row.commitDate && row.commitTime ? new Date(`${row.commitDate}T${row.commitTime}`) : new Date();
            const s = qr.manager.create(Shipment, {
              trackingNumber: row.trackingNumber, shipmentType: ShipmentType.FEDEX,
              recipientName: row.recipientName || 'N/A', recipientAddress: row.recipientAddress || 'N/A',
              recipientCity: row.recipientCity || predefinedSub.name, recipientZip: row.recipientZip || 'N/A',
              recipientPhone: row.recipientPhone || 'N/A', priority: getPriority(isNaN(commit.getTime()) ? now : commit),
              commitDateTime: isNaN(commit.getTime()) ? now : commit, consNumber: job.consNumber,
              status: ShipmentStatusType.PENDIENTE, createdAt: now, createdById: job.createdById,
              subsidiary: predefinedSub, consolidatedId,
            });
            const pay = parsePaymentCell(row.cod);
            (s as any).__payment = pay ? { amount: pay.amount, type: pay.type, status: 'pending', createdAt: now } : null;
            (s as any).__isHighValue = row.isHighValue === true;
            toSave.push(s);
          } catch (e: any) {
            result.failedTrackings.push({ trackingNumber: row.trackingNumber, reason: e?.message ?? 'map error' });
          }
        }

        // Reingresos: marcar viejos como DEVUELTO_A_FEDEX + nota.
        for (const tn of cls.toMarkReturned) {
          const prev = existing.get(tn);
          if (!prev) continue;
          await qr.manager.save(Shipment, { id: prev.id, status: ShipmentStatusType.DEVUELTO_A_FEDEX });
          await qr.manager.save(ShipmentStatus, qr.manager.create(ShipmentStatus, {
            status: ShipmentStatusType.DEVUELTO_A_FEDEX, notes: 'Reingreso detectado por import (paste).',
            timestamp: now, shipment: { id: prev.id }, exceptionCode: 'AUTO-RETURN',
          }));
        }

        const savedShipments = toSave.length ? await qr.manager.save(Shipment, toSave.map(({ __payment, __isHighValue, ...s }: any) => s), { chunk: 50 }) : [];
        const payments: any[] = []; const histories: any[] = []; const hvIds: string[] = [];
        savedShipments.forEach((s: any, i: number) => {
          const src = toSave[i];
          if (src.__payment) payments.push({ ...src.__payment, shipment: { id: s.id } });
          if (src.__isHighValue) hvIds.push(s.id);
          histories.push(qr.manager.create(ShipmentStatus, { status: ShipmentStatusType.PENDIENTE, notes: `Registro inicial. Cons: ${job.consNumber}`, timestamp: now, shipment: { id: s.id }, exceptionCode: 'INIT' }));
        });
        if (payments.length) await qr.manager.save(Payment, payments);
        if (histories.length) await qr.manager.save(ShipmentStatus, histories);
        if (hvIds.length) { await this.markHighValue(qr, hvIds); job.hvMarked += hvIds.length; }

        await qr.commitTransaction();
        job.saved += savedShipments.length;
        job.processedRows += batch.length;
        job.heartbeatAt = new Date();
        await this.jobRepo.save(job);
      } catch (e: any) {
        await qr.rollbackTransaction();
        for (const row of batch) result.failedTrackings.push({ trackingNumber: row.trackingNumber, reason: e?.message ?? 'batch error' });
      }
    }
    await qr.release();
  });

  job.failed = result.failedTrackings.length;
  job.result = JSON.stringify(result);
  job.status = job.saved === 0 && job.failed > 0 ? 'failed' : (job.failed > 0 ? 'partial' : 'done');
  job.finishedAt = new Date();
  await this.jobRepo.save(job);
}

/** Marca shipments como Alto Valor (mismo criterio que processHihValueShipments). */
private async markHighValue(qr: any, shipmentIds: string[]): Promise<void> {
  const { Shipment } = require('src/entities');
  await qr.manager.update(Shipment, { id: In(shipmentIds) }, { isHighValue: true } as any);
}

private chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
}
```

> **Nota de implementación:** confirmar el nombre real del flag Alto Valor en `Shipment` (`isHighValue` o el que use `processHihValueShipments`) leyendo `shipments.service.ts:1482`; ajustar `markHighValue` para igualarlo. Reemplazar los `require(...)` por `import` al inicio del archivo si el proyecto lo prefiere (equivalen).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shipments/import-jobs.service.spec.ts -t processMasterJob`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shipments/import-jobs.service.ts src/shipments/import-jobs.service.spec.ts
git commit -m "feat(import-jobs): estrategia master (insert PENDIENTE + reingresos + Alto Valor)"
```

---

## Task 5: Estrategia `charge` (insertar cargas + cobros)

**Files:**
- Modify: `src/shipments/import-jobs.service.ts` (`processChargeJob`, `applyCobros`)
- Test: `src/shipments/import-jobs.service.spec.ts`

**Interfaces:**
- Consumes: `findOrCreateCharge`-equivalente (reimplementado por filas), `resolveChargeCost`, `isSundayOrMexHoliday`, `resolveCobroTarget`.
- Produces: `ImportJobsService.processChargeJob(job: ImportJob): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('ImportJobsService.processChargeJob', () => {
  it('inserta cargas nuevas y aplica cobros por resolveCobroTarget', async () => {
    // Arrange: mock qr.manager con findOne(charge)->null (crea), find dedup->[],
    // findOne(Shipment por cons/guía)->null, findOne(ChargeShipment por cons/guía)->objeto para cobro.
    // Payload: 1 carga con cod. Assert: job.saved===1, job.cobrosApplied===1, status 'done'.
  });
});
```
(El worker/agente completa el arrange con los mocks del patrón de Task 4; la aserción exacta: `expect(job.saved).toBe(1); expect(job.cobrosApplied).toBe(1); expect(job.status).toBe('done')`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shipments/import-jobs.service.spec.ts -t processChargeJob`
Expected: FAIL.

- [ ] **Step 3: Implement `processChargeJob` + `applyCobros`**

Reglas (espejo de `processFileF2` + `processFileCharges`, por filas, en lotes cortos):

```ts
async processChargeJob(job: ImportJob): Promise<void> {
  const rows = (job.onlyTrackings
    ? (JSON.parse(job.payloadRows) as CanonicalRow[]).filter((r) => new Set(JSON.parse(job.onlyTrackings!)).has(r.trackingNumber))
    : (JSON.parse(job.payloadRows) as CanonicalRow[]));
  const result = { failedTrackings: [] as any[], duplicatedTrackings: [] as string[], cobrosUnmatchedTrackings: [] as string[], summary: {} as Record<string, number> };

  const { Subsidiary, Charge, ChargeShipment, ShipmentStatus, Income, Consolidated } = require('src/entities');
  const { resolveChargeCost } = require('src/utils/charge-cost.util'); // ajustar ruta si difiere
  const { isSundayOrMexHoliday } = require('src/utils/holidays.util');  // ajustar ruta si difiere

  await this.withConsolidatedLock(job.subsidiaryId, job.consNumber, async () => {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    const sub = await qr.manager.findOne(Subsidiary, { where: { id: job.subsidiaryId } });
    const extraHolidays = await this.holidaysService.getHolidayInputs();
    const isSunHol = isSundayOrMexHoliday(job.consDate ?? new Date(), extraHolidays);
    const chargeCost = resolveChargeCost(sub, job.isHalfTon, isSunHol);
    // find-or-create Charge por (consNumber, subsidiary) — reusar la MISMA regla que findOrCreateCharge.
    // ... (crear Charge si no existe; NO duplicar Income de cabecera)

    // dedup: cargas ya existentes en este cons.
    const tns = rows.map((r) => r.trackingNumber);
    const dup = tns.length ? await qr.manager.find(ChargeShipment, { where: { trackingNumber: In(tns), consNumber: job.consNumber } }) : [];
    const dupSet = new Set(dup.map((d: any) => d.trackingNumber));

    const batches = this.chunk(rows, this.BATCH);
    for (const batch of batches) {
      await qr.startTransaction();
      try {
        for (const row of batch) {
          try {
            if (dupSet.has(row.trackingNumber)) { result.duplicatedTrackings.push(row.trackingNumber); continue; }
            // migrar-o-insertar (escenario A/B de processFileF2), status PENDIENTE por defecto.
            // ... crear ChargeShipment ligado a Charge/consolidado; job.saved++
          } catch (e: any) {
            result.failedTrackings.push({ trackingNumber: row.trackingNumber, reason: e?.message ?? 'row error' });
          }
        }
        await qr.commitTransaction();
        job.processedRows += batch.length; job.heartbeatAt = new Date();
        await this.jobRepo.save(job);
      } catch (e: any) {
        await qr.rollbackTransaction();
        for (const row of batch) result.failedTrackings.push({ trackingNumber: row.trackingNumber, reason: e?.message ?? 'batch error' });
      }
    }

    // Sub-paso cobros: filas con cod.
    await this.applyCobros(rows.filter((r) => (r.cod ?? '').trim().length > 0), job, result);
    await qr.release();
  });

  job.failed = result.failedTrackings.length;
  job.cobrosUnmatched = result.cobrosUnmatchedTrackings.length;
  job.result = JSON.stringify(result);
  job.status = job.saved === 0 && job.failed > 0 ? 'failed' : (job.failed > 0 ? 'partial' : 'done');
  job.finishedAt = new Date();
  await this.jobRepo.save(job);
}

private async applyCobros(rowsWithCod: CanonicalRow[], job: ImportJob, result: any): Promise<void> {
  const { resolveCobroTarget } = require('./cobro-target.util');
  const { parsePaymentCell } = require('src/utils/file-upload.utils');
  for (const row of rowsWithCod) {
    const pay = parsePaymentCell(row.cod);
    if (!pay || !Number.isFinite(pay.amount)) { result.cobrosUnmatchedTrackings.push(row.trackingNumber); continue; }
    const shipmentByCons = await this.shipmentRepo.findOne({ where: { trackingNumber: row.trackingNumber, consNumber: job.consNumber }, relations: ['payment'], order: { createdAt: 'DESC' } });
    const chargeByCons = shipmentByCons ? null : await this.chargeShipmentRepo.findOne({ where: { trackingNumber: row.trackingNumber, consNumber: job.consNumber }, relations: ['payment'], order: { createdAt: 'DESC' } });
    const decision = resolveCobroTarget({ shipmentByCons, chargeByCons });
    if (!decision) { result.cobrosUnmatchedTrackings.push(row.trackingNumber); continue; }
    // upsert del payment sobre el target (misma lógica que processFileCharges).
    job.cobrosApplied += 1;
  }
}
```

> **Nota de implementación:** completar los `...` de `find-or-create Charge`, del escenario migrar/insertar y del upsert de payment leyendo `processFileF2` (`shipments.service.ts:843-1055`), `findOrCreateCharge` (`:1413`) y `processFileCharges` (`:1282-1366`). **Verificar las rutas reales** de `resolveChargeCost` e `isSundayOrMexHoliday` (grep) y corregir los `require`. Mantener el criterio de costeo idéntico (memoria: sobreprecio domingo/festivo, 31.5/1.5 ton).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shipments/import-jobs.service.spec.ts -t processChargeJob`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shipments/import-jobs.service.ts src/shipments/import-jobs.service.spec.ts
git commit -m "feat(import-jobs): estrategia charge (cargas F2/31.5) + sub-paso cobros"
```

---

## Task 6: Worker `@Cron` (reclamar / recuperar / despachar)

**Files:**
- Create: `src/shipments/import-jobs.worker.ts`
- Test: `src/shipments/import-jobs.worker.spec.ts`

**Interfaces:**
- Consumes: `ImportJobsService.processMasterJob`, `processChargeJob`; `ImportJob` repo; `DataSource`.
- Produces: `ImportJobsWorker.tick(): Promise<void>` (llamado por `@Cron`), `claimBatch()`, `recoverStuck()`.

- [ ] **Step 1: Write the failing test**

`src/shipments/import-jobs.worker.spec.ts`:

```ts
import { ImportJobsWorker } from './import-jobs.worker';

describe('ImportJobsWorker', () => {
  it('reclama un job pending, lo despacha por kind y lo procesa', async () => {
    const master = jest.fn().mockResolvedValue(undefined);
    const claimed = [{ id: 'J1', kind: 'master' }];
    const repo = {
      query: jest.fn(), // no usado directamente aquí
      find: jest.fn().mockResolvedValue(claimed),
      findOne: jest.fn().mockResolvedValue(claimed[0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const ds = { query: jest.fn().mockResolvedValue([]) };
    const svc: any = { processMasterJob: master, processChargeJob: jest.fn() };
    const worker = new ImportJobsWorker(repo as any, ds as any, svc);
    jest.spyOn<any, any>(worker, 'claimBatch').mockResolvedValue(claimed);
    await worker.tick();
    expect(master).toHaveBeenCalledWith(claimed[0]);
  });

  it('recupera colgados: processing con heartbeat viejo vuelve a pending', async () => {
    const ds = { query: jest.fn().mockResolvedValue([]) };
    const repo = { query: jest.fn(), find: jest.fn().mockResolvedValue([]), update: jest.fn() };
    const worker = new ImportJobsWorker(repo as any, ds as any, { processMasterJob: jest.fn(), processChargeJob: jest.fn() } as any);
    await worker.recoverStuck();
    // Debe ejecutar 2 UPDATEs (re-encolar < MAX, marcar failed >= MAX).
    expect((ds.query as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shipments/import-jobs.worker.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the worker**

`src/shipments/import-jobs.worker.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ImportJob } from '../entities/import-job.entity';
import { ImportJobsService } from './import-jobs.service';

const CLAIM_N = 3;
const STUCK_MIN = 5;
const MAX_ATTEMPTS = 3;

@Injectable()
export class ImportJobsWorker {
  private readonly logger = new Logger(ImportJobsWorker.name);
  private running = false;

  constructor(
    @InjectRepository(ImportJob) private readonly jobRepo: Repository<ImportJob>,
    private readonly dataSource: DataSource,
    private readonly service: ImportJobsService,
  ) {}

  @Cron('*/5 * * * * *') // cada 5s
  async tick(): Promise<void> {
    if (this.running) return; // evita solapamiento en el mismo proceso
    this.running = true;
    try {
      await this.recoverStuck();
      const jobs = await this.claimBatch();
      for (const job of jobs) {
        try {
          if (job.kind === 'master') await this.service.processMasterJob(job);
          else await this.service.processChargeJob(job);
        } catch (e: any) {
          this.logger.error(`Job ${job.id} falló: ${e?.message}`);
          await this.jobRepo.update(job.id, { status: 'failed', error: e?.message ?? 'error', finishedAt: new Date() });
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Claim-token: UPDATE optimista + SELECT (sin SKIP LOCKED). */
  async claimBatch(): Promise<ImportJob[]> {
    const token = randomUUID();
    await this.dataSource.query(
      `UPDATE import_job SET status='processing', claimToken=?, claimedAt=NOW(), startedAt=COALESCE(startedAt, NOW()), attempts=attempts+1, heartbeatAt=NOW()
       WHERE status='pending' ORDER BY createdAt ASC LIMIT ?`,
      [token, CLAIM_N],
    );
    return this.jobRepo.find({ where: { claimToken: token } });
  }

  /** Re-encola colgados; marca failed los que superan MAX_ATTEMPTS. */
  async recoverStuck(): Promise<void> {
    await this.dataSource.query(
      `UPDATE import_job SET status='pending', claimToken=NULL
       WHERE status='processing' AND heartbeatAt < (NOW() - INTERVAL ? MINUTE) AND attempts < ?`,
      [STUCK_MIN, MAX_ATTEMPTS],
    );
    await this.dataSource.query(
      `UPDATE import_job SET status='failed', error='stuck', finishedAt=NOW()
       WHERE status='processing' AND heartbeatAt < (NOW() - INTERVAL ? MINUTE) AND attempts >= ?`,
      [STUCK_MIN, MAX_ATTEMPTS],
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shipments/import-jobs.worker.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shipments/import-jobs.worker.ts src/shipments/import-jobs.worker.spec.ts
git commit -m "feat(import-jobs): worker @Cron con claim-token y recuperación de colgados"
```

---

## Task 7: Controller + wiring del módulo + descarga/reintento

**Files:**
- Create: `src/shipments/import-jobs.controller.ts`
- Modify: `src/shipments/shipments.module.ts` (controller + providers)
- Modify: `src/shipments/import-jobs.service.ts` (`buildFailedXlsx`, `retryFailed`)

**Interfaces:**
- Consumes: `ImportJobsService` (todo lo anterior).
- Produces: rutas `POST /import-jobs`, `POST /import-jobs/preview`, `GET /import-jobs/:id`, `GET /import-jobs`, `GET /import-jobs/:id/failed.xlsx`, `POST /import-jobs/:id/retry-failed`.

- [ ] **Step 1: Add `retryFailed` + `buildFailedXlsx` to the service**

```ts
async retryFailed(parentId: string): Promise<{ jobId: string }> {
  const parent = await this.jobRepo.findOne({ where: { id: parentId } });
  if (!parent) throw new NotFoundException('Job no encontrado');
  const res = parent.result ? JSON.parse(parent.result) : { failedTrackings: [] };
  const only = (res.failedTrackings || []).map((f: any) => f.trackingNumber);
  if (only.length === 0) throw new NotFoundException('No hay guías fallidas para reintentar.');
  const child = this.jobRepo.create({
    ...parent, id: undefined, status: 'pending', source: 'retry', parentJobId: parent.id,
    onlyTrackings: JSON.stringify(only), claimToken: null, attempts: 0,
    processedRows: 0, saved: 0, duplicated: 0, recycled: 0, failed: 0, hvMarked: 0,
    cobrosApplied: 0, cobrosUnmatched: 0, result: null, error: null,
    claimedAt: null, startedAt: null, heartbeatAt: null, finishedAt: null, consolidatedId: null,
  } as any);
  const saved = await this.jobRepo.save(child);
  return { jobId: saved.id };
}

async buildFailedXlsx(id: string): Promise<Buffer> {
  const XLSX = require('xlsx');
  const job = await this.jobRepo.findOne({ where: { id } });
  if (!job) throw new NotFoundException('Job no encontrado');
  const res = job.result ? JSON.parse(job.result) : { failedTrackings: [] };
  const aoa = [['trackingNumber', 'reason'], ...(res.failedTrackings || []).map((f: any) => [f.trackingNumber, f.reason])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Fallidas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
```

- [ ] **Step 2: Write the controller**

`src/shipments/import-jobs.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { ImportJobsService } from './import-jobs.service';
import { CreateImportJobDto, PreviewImportDto } from './import-jobs.dto';

@ApiTags('import-jobs')
@Controller('import-jobs')
export class ImportJobsController {
  constructor(private readonly service: ImportJobsService) {}

  @Post('preview')
  preview(@Body() dto: PreviewImportDto) {
    return this.service.preview(dto);
  }

  @Post()
  create(@Body() dto: CreateImportJobDto, @Req() req?: any) {
    return this.service.create(dto, { userId: req?.user?.userId, name: req?.user?.name });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get()
  list(@Query('subsidiaryId') subsidiaryId?: string, @Query('kind') kind?: string, @Query('limit') limit?: string) {
    return this.service.list(subsidiaryId, kind, limit ? Number(limit) : 25);
  }

  @Get(':id/failed.xlsx')
  async failedXlsx(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.service.buildFailedXlsx(id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import-${id}-fallidas.xlsx"`);
    res.end(buf);
  }

  @Post(':id/retry-failed')
  retry(@Param('id') id: string) {
    return this.service.retryFailed(id);
  }
}
```

> **Nota:** aplicar el mismo guard de auth que el resto del controller de shipments (revisar decoradores `@UseGuards`/`@Permissions` en `shipments.controller.ts`) y exigir `operaciones.pegarFedex`.

- [ ] **Step 3: Wire the module**

En `src/shipments/shipments.module.ts`:

```ts
// controllers: [ShipmentsController, ImportJobsController],
// providers: [..., ImportJobsService, ImportJobsWorker],
```

- [ ] **Step 4: Build + smoke**

Run: `npm run build`
Expected: compila.
Run: `npx jest src/shipments/import-jobs`
Expected: PASS (util + service + worker).

- [ ] **Step 5: Commit**

```bash
git add src/shipments/import-jobs.controller.ts src/shipments/import-jobs.service.ts src/shipments/shipments.module.ts
git commit -m "feat(import-jobs): controller + wiring + descarga fallidas + retry-failed"
```

---

## Task 8: Verificación end-to-end manual + cierre

**Files:** (ninguno nuevo; verificación)

- [ ] **Step 1: Levantar el API y probar el flujo master**

Con la BD migrada, `POST /import-jobs` con `{ kind:'master', subsidiaryId, consNumber, rows:[{trackingNumber:'...'}] }`. Verificar respuesta `{ jobId }`, luego `GET /import-jobs/:id` hasta `status:'done'`. Confirmar en BD: shipments creados como `PENDIENTE`, ligados al consolidado, con historial `INIT`.

- [ ] **Step 2: Confirmar enriquecimiento por cron**

Ejecutar `GET /shipments/test-new-cron` (o esperar el cron). Confirmar que los `PENDIENTE` recién insertados reciben estatus/historial/ingreso de FedEx.

- [ ] **Step 3: Probar charge + cobros e idempotencia**

`POST /import-jobs` con `kind:'charge'` y filas con `cod`. Confirmar cargas + `cobrosApplied`. Repetir el MISMO `POST` (mismo payload) dentro de 30 min → `deduped:true`, sin consolidado/carga duplicada.

- [ ] **Step 4: Probar reintento de fallidas**

Forzar una fila inválida, confirmar `status:'partial'` + `failed>0`, descargar `GET /import-jobs/:id/failed.xlsx`, y `POST /import-jobs/:id/retry-failed` → nuevo job que procesa solo esas.

- [ ] **Step 5: Suite completa + commit final**

Run: `npx jest src/shipments`
Expected: PASS (sin romper specs existentes).

```bash
git add -A
git commit -m "test(import-jobs): verificación e2e del flujo paste (master/charge/retry)"
```

---

## Self-Review (cobertura del spec)

- §5.1 entidad → Task 2. §5.2 endpoints → Tasks 3 (create/preview/get/list) + 7 (failed.xlsx/retry). §5.3 worker → Task 6. §5.4 service/helpers → Tasks 3-5. §5.5 contrato de fila → Task 1 (`CanonicalRow`, `parsePastedRows`). §6.1 master → Task 4. §6.2 charge + cobros → Task 5. §7 idempotencia/lock → Task 3 (idempotencia) + Task 4 (`GET_LOCK`). §7.1 parámetros → constantes en Tasks 3/4/6. §8 coexistencia → altas aditivas en Tasks 2/7. §9 pruebas → tests en cada task.
- **Puntos que requieren confirmar contra el código al implementar (marcados como Nota):** nombre real del flag Alto Valor en `Shipment`; rutas de `resolveChargeCost`/`isSundayOrMexHoliday`; detalle de `findOrCreateCharge` y del upsert de cobro; decoradores de auth. Estos son *reuso de lógica existente*, por eso el plan referencia las líneas fuente en vez de re-copiar 300+ líneas delicadas.
