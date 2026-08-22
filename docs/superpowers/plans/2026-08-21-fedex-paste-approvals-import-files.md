# FedEx Paste · Delete-with-Approval · Import Files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three independent features — (C) persist the original FedEx upload files + metadata, (B) delete consolidado / route dispatch behind a per-subsidiary supervisor approval with a top-bar approval tray and logical delete, and (A) an experimental copy/paste alternative to FedEx file uploads.

**Architecture:** Backend is NestJS + TypeORM (MySQL, `DB_SYNC=false` → every schema change is a defensive migration). Frontend is Next.js (App Router) with shadcn/ui + Tailwind, SWR for data. We reuse three existing patterns: `EmailLogService.persistAttachments` (disk storage under `uploads/…`), `NotificationsService.emit` + `notification-catalog.ts` (bell + email), and the `NotificationBell` popover/hook shape.

**Tech Stack:** NestJS, TypeORM, Jest, MySQL; Next.js, React, SWR, shadcn/ui, Tailwind, lucide-react, SheetJS (`xlsx`).

## Global Constraints

- Backend repo: `C:\PMY\pmy-api`. Frontend repo: `C:\PMY\app-pmy`.
- `DB_SYNC=false` in ALL environments (dev included). Every schema change is a migration in `src/database/migrations/` named `1786000000NNN-Name.ts`, class `Name1786000000NNN`, next free number after `1786000000054`. Migrations MUST guard with `information_schema` (`columnExists` / `tableExists`) because of the project's `synchronize` history. Follow the exact style of `1786000000053-AddSundayHolidayChargeCost.ts`.
- MySQL booleans: use `tinyint`/`BOOLEAN DEFAULT 1`. Entities use `@Column({ default: true }) active: boolean`.
- All new frontend screens/components live inside `AppLayout` + `withAuth` + `OperationHeader` and are built ONLY with shadcn (`@/components/ui/*`) + Tailwind. No raw HTML pages.
- Backend test command: `npx jest <path>` (jest globalSetup forces `TZ=UTC`). Frontend tests: `npx vitest run <path>` from `C:\PMY\app-pmy`.
- Roles: `superadmin` (and legacy typo `superamin`) always bypass. There is NO "supervisor" role — the approver is a per-subsidiary configured user, falling back to the first active `superadmin` (Admin Principal).
- Current-user in a controller: `@Req() req` → `req.user.userId`, `req.user.role`, `req.user.permissions`, `req.user.name`.
- Commit after every task with the shown message. Do not push unless asked. End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- After finishing all backend tasks in a repo, run `graphify update .` in `C:\PMY\pmy-api`.

---

## File Structure

**Backend (`C:\PMY\pmy-api/src`)**
- `entities/import-file.entity.ts` — new `ImportFile` entity (Feature C).
- `import-files/import-files.service.ts` / `.controller.ts` / `.module.ts` — import-file persistence + download + history (C).
- `entities/approval-request.entity.ts` — new `ApprovalRequest` entity (B).
- `approvals/approvals.service.ts` / `.controller.ts` / `.module.ts` / `approvals.types.ts` — approval workflow + logical delete (B).
- `approvals/impact.service.ts` — pure-ish impact-count builder (B).
- `database/migrations/1786000000055-AddImportFileTable.ts` (C)
- `database/migrations/1786000000056-AddActiveAndSupervisorAndApprovals.ts` (B)
- Modify: `shipments/shipments.controller.ts` (wire C into 4 upload endpoints), `shipments/shipments.module.ts` (import `ImportFilesModule`), `notifications/notification-catalog.ts` (3 new types), `consolidated/consolidated.service.ts` (filter `active`), `package-dispatch/package-dispatch.service.ts` (filter `active`), `subsidiaries/*` config (supervisor selector endpoint if not already generic), `entities/consolidated.entity.ts`, `entities/package-dispatch.entity.ts`, `entities/shipment.entity.ts`, `entities/charge-shipment.entity.ts`, `entities/subsidiary.entity.ts`, `app.module.ts` (register new modules).

**Frontend (`C:\PMY\app-pmy`)**
- `lib/services/import-files.ts` (C), `lib/services/approvals.ts` (B).
- `hooks/services/approvals/use-my-approvals.ts` (B).
- `components/approvals/delete-request-dialog.tsx` (B), `components/approvals/approval-tray.tsx` (B).
- `components/import-components/paste-import-modal.tsx` (A).
- Modify: `components/app-layout.tsx` (mount `<ApprovalTray/>`), consolidado detail component (source-file section + delete button), route-dispatch list (delete button), `app/operaciones/envios/page.tsx` (paste button), a new `app/operaciones/importaciones/page.tsx` (history), subsidiary config screen (supervisor selector).

---

# FEATURE C — Import Files (do this first)

### Task C1: `ImportFile` entity + migration

**Files:**
- Create: `src/entities/import-file.entity.ts`
- Create: `src/database/migrations/1786000000055-AddImportFileTable.ts`

**Interfaces:**
- Produces: entity `ImportFile` with fields `id, carrier, kind, originalName, storagePath, mimeType, size, rowCount, subsidiaryId, consNumber, consolidatedId, uploadedById, uploadedByName, createdAt`.

- [ ] **Step 1: Create the entity**

```ts
// src/entities/import-file.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ImportFileKind = 'master' | 'payment' | 'high_value' | 'f2';

@Entity('import_file')
export class ImportFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'FEDEX' })
  carrier: string;

  @Column()
  kind: ImportFileKind;

  @Column()
  originalName: string;

  @Column()
  storagePath: string; // relativo a process.cwd()

  @Column({ default: 'application/octet-stream' })
  mimeType: string;

  @Column({ type: 'int', default: 0 })
  size: number;

  @Column({ type: 'int', nullable: true })
  rowCount: number | null;

  @Index()
  @Column({ nullable: true })
  subsidiaryId: string | null;

  @Column({ nullable: true })
  consNumber: string | null;

  @Index()
  @Column({ nullable: true })
  consolidatedId: string | null;

  @Column({ nullable: true })
  uploadedById: string | null;

  @Column({ nullable: true })
  uploadedByName: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
```

- [ ] **Step 2: Create the migration** (mirror `1786000000053` style, guard with `information_schema`)

```ts
// src/database/migrations/1786000000055-AddImportFileTable.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImportFileTable1786000000055 implements MigrationInterface {
  name = 'AddImportFileTable1786000000055';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_file')) return;
    await queryRunner.query(`
      CREATE TABLE \`import_file\` (
        \`id\` varchar(36) NOT NULL,
        \`carrier\` varchar(255) NOT NULL DEFAULT 'FEDEX',
        \`kind\` varchar(255) NOT NULL,
        \`originalName\` varchar(255) NOT NULL,
        \`storagePath\` varchar(255) NOT NULL,
        \`mimeType\` varchar(255) NOT NULL DEFAULT 'application/octet-stream',
        \`size\` int NOT NULL DEFAULT 0,
        \`rowCount\` int NULL,
        \`subsidiaryId\` varchar(36) NULL,
        \`consNumber\` varchar(255) NULL,
        \`consolidatedId\` varchar(36) NULL,
        \`uploadedById\` varchar(36) NULL,
        \`uploadedByName\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_import_file_subsidiary\` (\`subsidiaryId\`),
        KEY \`IDX_import_file_consolidated\` (\`consolidatedId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_file')) {
      await queryRunner.query(`DROP TABLE \`import_file\``);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS (no errors referencing the new files).

- [ ] **Step 4: Commit**

```bash
git add src/entities/import-file.entity.ts src/database/migrations/1786000000055-AddImportFileTable.ts
git commit -m "feat(import-files): entidad ImportFile + migración de tabla"
```

---

### Task C2: `ImportFilesService` (persist / list / download) + unit test

**Files:**
- Create: `src/import-files/import-files.service.ts`
- Create: `src/import-files/import-files.service.spec.ts`

**Interfaces:**
- Consumes: `ImportFile` entity (C1).
- Produces:
  - `persist(file: { originalname: string; buffer: Buffer; mimetype?: string }, meta: PersistMeta): Promise<ImportFile>` where `PersistMeta = { kind: ImportFileKind; subsidiaryId?: string|null; consNumber?: string|null; rowCount?: number|null; uploadedById?: string|null; uploadedByName?: string|null }`. Writes buffer to `uploads/imports/fedex/<consNumber|yyyy-MM-dd>/<uuid>-<originalName>`, resolves `consolidatedId` by looking up a FEDEX consolidated with matching `consNumber`+`subsidiaryId` (best-effort, null on miss), inserts and returns the row. NEVER throws to caller (logs + returns a minimal row on disk-write failure? No — on disk failure it logs and rethrows a swallowed warning; caller wraps in try/catch).
  - `list(params: { subsidiaryId?: string; kind?: string; from?: Date; to?: Date; limit?: number }): Promise<ImportFile[]>`
  - `findByConsolidated(consolidatedId: string): Promise<ImportFile[]>`
  - `getDownloadable(id: string): Promise<{ buffer: Buffer; originalName: string; mimeType: string }>` (throws `NotFoundException` if row or file missing).

- [ ] **Step 1: Write the failing test**

```ts
// src/import-files/import-files.service.spec.ts
import { promises as fs } from 'fs';
import { join } from 'path';
import { ImportFilesService } from './import-files.service';

function repoMock() {
  const store: any[] = [];
  return {
    store,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { const row = { id: 'imp-1', createdAt: new Date(), ...x }; store.push(row); return row; },
    find: async () => store,
    findOne: async ({ where }: any) => store.find((r) => r.id === where.id) ?? null,
  } as any;
}
// Consolidated repo that returns a match so consolidatedId gets resolved.
function consRepoMock(id: string | null) {
  return { findOne: async () => (id ? { id } : null) } as any;
}

describe('ImportFilesService.persist', () => {
  it('writes the buffer to disk and stores metadata with resolved consolidatedId', async () => {
    const importRepo = repoMock();
    const svc = new ImportFilesService(importRepo, consRepoMock('cons-9'));
    const row = await svc.persist(
      { originalname: 'aereo.xlsx', buffer: Buffer.from('hello'), mimetype: 'application/vnd.ms-excel' },
      { kind: 'master', subsidiaryId: 'sub-1', consNumber: 'CONS-1', rowCount: 3, uploadedById: 'u1', uploadedByName: 'Ada' },
    );
    expect(row.originalName).toBe('aereo.xlsx');
    expect(row.size).toBe(5);
    expect(row.consolidatedId).toBe('cons-9');
    expect(row.kind).toBe('master');
    const abs = join(process.cwd(), row.storagePath);
    const content = await fs.readFile(abs);
    expect(content.toString()).toBe('hello');
    await fs.rm(join(process.cwd(), 'uploads', 'imports', 'fedex'), { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\PMY\pmy-api && npx jest src/import-files/import-files.service.spec.ts`
Expected: FAIL ("Cannot find module './import-files.service'").

- [ ] **Step 3: Implement the service**

```ts
// src/import-files/import-files.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ImportFile, ImportFileKind } from 'src/entities/import-file.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';

export interface PersistMeta {
  kind: ImportFileKind;
  subsidiaryId?: string | null;
  consNumber?: string | null;
  rowCount?: number | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}

@Injectable()
export class ImportFilesService {
  private readonly logger = new Logger(ImportFilesService.name);

  constructor(
    @InjectRepository(ImportFile) private readonly repo: Repository<ImportFile>,
    @InjectRepository(Consolidated) private readonly consRepo: Repository<Consolidated>,
  ) {}

  private abs(rel: string): string { return join(process.cwd(), rel); }

  private safeName(name: string): string {
    return (name || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  }

  private async resolveConsolidatedId(consNumber?: string | null, subsidiaryId?: string | null): Promise<string | null> {
    if (!consNumber) return null;
    try {
      const where: any = { consNumber, carrier: ShipmentType.FEDEX };
      if (subsidiaryId) where.subsidiary = { id: subsidiaryId };
      const c = await this.consRepo.findOne({ where });
      return c?.id ?? null;
    } catch { return null; }
  }

  async persist(
    file: { originalname: string; buffer: Buffer; mimetype?: string },
    meta: PersistMeta,
  ): Promise<ImportFile> {
    const folder = this.safeName(meta.consNumber || new Date().toISOString().slice(0, 10));
    const relDir = join('uploads', 'imports', 'fedex', folder);
    await fs.mkdir(this.abs(relDir), { recursive: true });
    const stored = `${randomUUID()}-${this.safeName(file.originalname)}`;
    const relPath = join(relDir, stored);
    await fs.writeFile(this.abs(relPath), file.buffer);

    const consolidatedId = await this.resolveConsolidatedId(meta.consNumber, meta.subsidiaryId);
    const row = this.repo.create({
      carrier: 'FEDEX',
      kind: meta.kind,
      originalName: file.originalname,
      storagePath: relPath,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.buffer.length,
      rowCount: meta.rowCount ?? null,
      subsidiaryId: meta.subsidiaryId ?? null,
      consNumber: meta.consNumber ?? null,
      consolidatedId,
      uploadedById: meta.uploadedById ?? null,
      uploadedByName: meta.uploadedByName ?? null,
    });
    return this.repo.save(row);
  }

  async list(params: { subsidiaryId?: string; kind?: string; from?: Date; to?: Date; limit?: number } = {}): Promise<ImportFile[]> {
    const where: any = {};
    if (params.subsidiaryId) where.subsidiaryId = params.subsidiaryId;
    if (params.kind) where.kind = params.kind;
    if (params.from && params.to) where.createdAt = Between(params.from, params.to);
    else if (params.from) where.createdAt = MoreThanOrEqual(params.from);
    else if (params.to) where.createdAt = LessThanOrEqual(params.to);
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: params.limit ?? 200 });
  }

  async findByConsolidated(consolidatedId: string): Promise<ImportFile[]> {
    return this.repo.find({ where: { consolidatedId }, order: { createdAt: 'DESC' } });
  }

  async getDownloadable(id: string): Promise<{ buffer: Buffer; originalName: string; mimeType: string }> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Archivo de importación no encontrado');
    try {
      const buffer = await fs.readFile(this.abs(row.storagePath));
      return { buffer, originalName: row.originalName, mimeType: row.mimeType };
    } catch {
      throw new NotFoundException('El archivo ya no está disponible en disco');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\PMY\pmy-api && npx jest src/import-files/import-files.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/import-files/import-files.service.ts src/import-files/import-files.service.spec.ts
git commit -m "feat(import-files): servicio persist/list/download con test"
```

---

### Task C3: `ImportFilesController` + module + registration

**Files:**
- Create: `src/import-files/import-files.controller.ts`
- Create: `src/import-files/import-files.module.ts`
- Modify: `src/app.module.ts` (add `ImportFilesModule` to imports)

**Interfaces:**
- Consumes: `ImportFilesService` (C2).
- Produces: routes `GET /import-files`, `GET /import-files/by-consolidated/:id`, `GET /import-files/:id/download`; `ImportFilesModule` exports `ImportFilesService` (so `ShipmentsModule` can inject it).

- [ ] **Step 1: Create the controller**

```ts
// src/import-files/import-files.controller.ts
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ImportFilesService } from './import-files.service';

@UseGuards(JwtAuthGuard)
@Controller('import-files')
export class ImportFilesController {
  constructor(private readonly service: ImportFilesService) {}

  @Get()
  list(@Query() q: { subsidiaryId?: string; kind?: string; from?: string; to?: string; limit?: string }) {
    return this.service.list({
      subsidiaryId: q.subsidiaryId,
      kind: q.kind,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get('by-consolidated/:id')
  byConsolidated(@Param('id') id: string) {
    return this.service.findByConsolidated(id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const f = await this.service.getDownloadable(id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.originalName)}"`);
    res.send(f.buffer);
  }
}
```

- [ ] **Step 2: Create the module**

```ts
// src/import-files/import-files.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportFile } from 'src/entities/import-file.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { ImportFilesService } from './import-files.service';
import { ImportFilesController } from './import-files.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ImportFile, Consolidated])],
  controllers: [ImportFilesController],
  providers: [ImportFilesService],
  exports: [ImportFilesService],
})
export class ImportFilesModule {}
```

- [ ] **Step 3: Register in `app.module.ts`**

Add `import { ImportFilesModule } from './import-files/import-files.module';` and add `ImportFilesModule` to the `imports: [...]` array of `AppModule`.

- [ ] **Step 4: Typecheck + build**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/import-files/import-files.controller.ts src/import-files/import-files.module.ts src/app.module.ts
git commit -m "feat(import-files): controller de historial/descarga + módulo registrado"
```

---

### Task C4: Wire persistence into the 4 FedEx upload endpoints

**Files:**
- Modify: `src/shipments/shipments.controller.ts` (endpoints `upload` @288, `upload-charge` @384, `upload-payment` @445, `upload-hv` @471)
- Modify: `src/shipments/shipments.module.ts` (import `ImportFilesModule`)

**Interfaces:**
- Consumes: `ImportFilesService.persist(file, meta)` (C2).

The upload service methods already resolve/create the consolidated by `consNumber` + `subsidiaryId`; `persist` re-looks it up to fill `consolidatedId`, so we only need to call `persist` AFTER a successful upload, inside a `try/catch` that never breaks the upload response. `rowCount` comes from the result when present (`result.saved`).

- [ ] **Step 1: Import the module**

In `src/shipments/shipments.module.ts` add `import { ImportFilesModule } from '../import-files/import-files.module';` and add `ImportFilesModule` to `imports: [...]`.

- [ ] **Step 2: Inject the service** into `ShipmentsController` constructor

Add parameter `private readonly importFiles: ImportFilesService,` (import from `../import-files/import-files.service`).

- [ ] **Step 3: Persist in `upload` (master/aéreo)**

In `uploadFile`, immediately after the successful `const result = await this.shipmentsService.addConsMasterBySubsidiary(...)` and BEFORE `return res...json(result)`, add:

```ts
try {
  await this.importFiles.persist(
    { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
    { kind: 'master', subsidiaryId: dto.subsidiaryId, consNumber: dto.consNumber || '', rowCount: result?.saved ?? null, uploadedById: req?.user?.userId, uploadedByName: req?.user?.name },
  );
} catch (e) { this.logger.warn(`[upload] no se pudo guardar import_file: ${(e as any)?.message}`); }
```

- [ ] **Step 4: Persist in `upload-charge` (F2), `upload-payment` (COD), `upload-hv` (high value)**

These methods currently `return this.shipmentsService.<method>(...)` directly. Convert each to `await` the result into a variable, persist, then return. Example for `uploadChargeFile` (kind is `'f2'`; both `addChargeShipments` and `processFileF2` map to kind `'f2'`):

```ts
const result = shouldNotRemove
  ? await this.shipmentsService.addChargeShipments(file, subsidiaryId, consNumber, dateForCons, req?.user?.userId, halfTon)
  : await this.shipmentsService.processFileF2(file, subsidiaryId, consNumber, dateForCons, req?.user?.userId, halfTon);
try {
  await this.importFiles.persist(
    { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
    { kind: 'f2', subsidiaryId, consNumber, rowCount: (result as any)?.saved ?? null, uploadedById: req?.user?.userId, uploadedByName: req?.user?.name },
  );
} catch (e) { this.logger.warn(`[upload-charge] import_file: ${(e as any)?.message}`); }
return result;
```

For `uploadPaymentFile` use `kind: 'payment'` (it only has `consNumber`; pass `subsidiaryId: null`). Add `@Req() req?: any` param to `uploadPaymentFile` and `uploadHighValueFile` if missing, to capture the uploader. For `upload-hv` use `kind: 'high_value'`.

- [ ] **Step 5: Typecheck**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual smoke (optional if a dev DB is available)** — start API, upload a small FedEx file, confirm a row appears: `SELECT id, kind, originalName, consolidatedId FROM import_file ORDER BY createdAt DESC LIMIT 5;`

- [ ] **Step 7: Commit**

```bash
git add src/shipments/shipments.controller.ts src/shipments/shipments.module.ts
git commit -m "feat(import-files): guardar archivo original en los 4 uploads FedEx"
```

---

### Task C5: Frontend — import-files service + consolidado "Archivo de origen" + Importaciones history

**Files:**
- Create: `C:\PMY\app-pmy\lib\services\import-files.ts`
- Create: `C:\PMY\app-pmy\app\operaciones\importaciones\page.tsx`
- Modify: the consolidado detail component (find it: the component rendering a single consolidado's shipments, wired from `app/operaciones/consolidados`) to add a "Archivo de origen" card.

**Interfaces:**
- Consumes: backend `GET /import-files`, `GET /import-files/by-consolidated/:id`, `GET /import-files/:id/download`.
- Produces: `ImportFileItem` type; `listImportFiles`, `getImportFilesByConsolidated`, `downloadImportFileUrl(id)`.

- [ ] **Step 1: Create the service** (follow the axios/base pattern used by `lib/services/consolidated.ts`)

```ts
// lib/services/import-files.ts
import { api } from "@/lib/api"; // use the same client the other services import

export interface ImportFileItem {
  id: string;
  carrier: string;
  kind: "master" | "payment" | "high_value" | "f2";
  originalName: string;
  size: number;
  rowCount: number | null;
  subsidiaryId: string | null;
  consNumber: string | null;
  consolidatedId: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export async function listImportFiles(params: { subsidiaryId?: string; kind?: string; from?: string; to?: string } = {}): Promise<ImportFileItem[]> {
  const { data } = await api.get("/import-files", { params });
  return data;
}

export async function getImportFilesByConsolidated(consolidatedId: string): Promise<ImportFileItem[]> {
  const { data } = await api.get(`/import-files/by-consolidated/${consolidatedId}`);
  return data;
}

export function downloadImportFileUrl(id: string): string {
  return `/import-files/${id}/download`;
}
```

> NOTE for implementer: open `lib/services/consolidated.ts` first and copy its EXACT import of the HTTP client (name/path) and its download conventions; adjust the two lines above to match. Downloads that need auth headers should reuse the existing "download via axios blob → object URL" helper if the codebase has one (grep `responseType: "blob"`).

- [ ] **Step 2: Consolidado detail — "Archivo de origen" card**

In the consolidado detail component, call `getImportFilesByConsolidated(consolidatedId)` (via SWR or `useEffect`) and render a shadcn `Card` listing each file: `originalName`, `kind` label (`Aéreo/Master`, `Cobros`, `Alto Valor`, `F2`), `rowCount`, `uploadedByName`, `createdAt`, and a Download button that fetches the blob from `downloadImportFileUrl(id)` and triggers a client save. If empty, show muted "Sin archivo de origen registrado".

- [ ] **Step 3: Importaciones history page**

`app/operaciones/importaciones/page.tsx` — a screen wrapped with `withAuth` + `OperationHeader` (icon e.g. `FileSpreadsheet`, title "Importaciones") using a shadcn `Table` with columns Archivo, Tipo, Sucursal, Filas, Subió, Fecha, Descargar. Filters: subsidiary select, kind select, date range. Data from `listImportFiles`. Mirror an existing operaciones list page for the exact `withAuth`/`OperationHeader`/layout boilerplate (e.g. `app/operaciones/consolidados/page.tsx`).

- [ ] **Step 4: Add nav entry** for "Importaciones" wherever operaciones routes are registered in the sidebar (`components/app-sidebar` or the route/permission map). Gate to the same roles as consolidados.

- [ ] **Step 5: Typecheck**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/import-files.ts app/operaciones/importaciones/page.tsx components/app-sidebar.tsx
git commit -m "feat(import-files): servicio + Archivo de origen en consolidado + historial Importaciones"
```

---

# FEATURE B — Delete with supervisor approval + top-bar tray

### Task B1: Schema — `active` columns, `supervisorUserId`, `approval_request` table

**Files:**
- Modify: `src/entities/consolidated.entity.ts`, `src/entities/package-dispatch.entity.ts`, `src/entities/shipment.entity.ts`, `src/entities/charge-shipment.entity.ts`, `src/entities/subsidiary.entity.ts`
- Create: `src/entities/approval-request.entity.ts`
- Create: `src/database/migrations/1786000000056-AddActiveAndSupervisorAndApprovals.ts`

**Interfaces:**
- Produces: `active: boolean` on consolidated / package_dispatch / shipment / charge_shipment; `supervisorUserId: string | null` on subsidiary; `ApprovalRequest` entity.

- [ ] **Step 1: Add `active` to the four entities**

To each of `consolidated.entity.ts`, `package-dispatch.entity.ts`, `shipment.entity.ts`, `charge-shipment.entity.ts`, add:

```ts
@Column({ default: true })
active: boolean;
```

- [ ] **Step 2: Add `supervisorUserId` to `subsidiary.entity.ts`**

```ts
/** Encargado/Supervisor que autoriza borrados de esta sucursal. Configurable. */
@Column({ nullable: true })
supervisorUserId: string | null;
```

- [ ] **Step 3: Create `ApprovalRequest` entity**

```ts
// src/entities/approval-request.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ApprovalType = 'delete_consolidado' | 'delete_route_dispatch';
export type ApprovalStatus = 'pendiente' | 'aprobado' | 'rechazado';

@Entity('approval_request')
export class ApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: ApprovalType;

  @Index()
  @Column()
  targetId: string;

  @Column({ nullable: true })
  subsidiaryId: string | null;

  @Column({ nullable: true })
  requestedById: string | null;

  @Column({ nullable: true })
  requestedByName: string | null;

  @Index()
  @Column({ nullable: true })
  approverId: string | null;

  @Column({ nullable: true })
  approverName: string | null;

  @Index()
  @Column({ default: 'pendiente' })
  status: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'json', nullable: true })
  impactSnapshot: any;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date | null;
}
```

- [ ] **Step 4: Create the migration** (guard each column with `columnExists`, table with `tableExists`; backfill existing rows to `active = 1`)

```ts
// src/database/migrations/1786000000056-AddActiveAndSupervisorAndApprovals.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActiveAndSupervisorAndApprovals1786000000056 implements MigrationInterface {
  name = 'AddActiveAndSupervisorAndApprovals1786000000056';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
    return Number(rows[0].c) > 0;
  }
  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
    return Number(rows[0].c) > 0;
  }
  private async addActive(qr: QueryRunner, table: string) {
    if (!(await this.columnExists(qr, table, 'active'))) {
      await qr.query(`ALTER TABLE \`${table}\` ADD COLUMN \`active\` tinyint NOT NULL DEFAULT 1`);
      await qr.query(`UPDATE \`${table}\` SET \`active\` = 1 WHERE \`active\` IS NULL`);
    }
  }

  public async up(qr: QueryRunner): Promise<void> {
    await this.addActive(qr, 'consolidated');
    await this.addActive(qr, 'package_dispatch');
    await this.addActive(qr, 'shipment');
    await this.addActive(qr, 'charge_shipment');

    if (!(await this.columnExists(qr, 'subsidiary', 'supervisorUserId'))) {
      await qr.query(`ALTER TABLE \`subsidiary\` ADD COLUMN \`supervisorUserId\` varchar(36) NULL`);
    }

    if (!(await this.tableExists(qr, 'approval_request'))) {
      await qr.query(`
        CREATE TABLE \`approval_request\` (
          \`id\` varchar(36) NOT NULL,
          \`type\` varchar(255) NOT NULL,
          \`targetId\` varchar(36) NOT NULL,
          \`subsidiaryId\` varchar(36) NULL,
          \`requestedById\` varchar(36) NULL,
          \`requestedByName\` varchar(255) NULL,
          \`approverId\` varchar(36) NULL,
          \`approverName\` varchar(255) NULL,
          \`status\` varchar(255) NOT NULL DEFAULT 'pendiente',
          \`reason\` text NULL,
          \`impactSnapshot\` json NULL,
          \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`resolvedAt\` datetime NULL,
          PRIMARY KEY (\`id\`),
          KEY \`IDX_approval_target\` (\`targetId\`),
          KEY \`IDX_approval_approver\` (\`approverId\`),
          KEY \`IDX_approval_status\` (\`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    if (await this.tableExists(qr, 'approval_request')) await qr.query(`DROP TABLE \`approval_request\``);
    if (await this.columnExists(qr, 'subsidiary', 'supervisorUserId')) await qr.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`supervisorUserId\``);
    for (const t of ['charge_shipment', 'shipment', 'package_dispatch', 'consolidated']) {
      if (await this.columnExists(qr, t, 'active')) await qr.query(`ALTER TABLE \`${t}\` DROP COLUMN \`active\``);
    }
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/*.ts src/database/migrations/1786000000056-AddActiveAndSupervisorAndApprovals.ts
git commit -m "feat(approvals): columnas active + supervisorUserId + tabla approval_request"
```

---

### Task B2: Impact builder + unit test

**Files:**
- Create: `src/approvals/impact.service.ts`
- Create: `src/approvals/impact.service.spec.ts`

**Interfaces:**
- Produces: `ApprovalImpactService.build(type, targetId): Promise<ImpactSnapshot>` where
  `ImpactSnapshot = { type; targetId; label: string; createdByName?: string; subsidiaryId?: string|null; counts: { shipments: number; charges: number; enRuta: number; withIncome: number; devoluciones?: number; hasRouteClosure?: boolean } }`.

- [ ] **Step 1: Write the failing test** (repo mocks return canned counts)

```ts
// src/approvals/impact.service.spec.ts
import { ApprovalImpactService } from './impact.service';

const consRepo = () => ({ findOne: async () => ({ id: 'c1', consNumber: 'CONS-1', subsidiary: { id: 's1' }, createdBy: { name: 'Ada' } }) }) as any;
const dispatchRepo = () => ({ findOne: async () => null }) as any;
// count() calls resolve in declared order via a queue
function countRepo(values: number[]) {
  let i = 0;
  return { count: async () => values[i++] ?? 0 } as any;
}

describe('ApprovalImpactService.build (consolidado)', () => {
  it('aggregates shipment/charge/en-ruta/income counts', async () => {
    const svc = new ApprovalImpactService(
      consRepo(), dispatchRepo(),
      countRepo([10, 2]),        // shipmentRepo: total, enRuta
      countRepo([3, 1]),         // chargeRepo: total, enRuta
      countRepo([4]),            // incomeRepo: withIncome
      { findOne: async () => null } as any, // routeClosureRepo
    );
    const impact = await svc.build('delete_consolidado', 'c1');
    expect(impact.counts.shipments).toBe(10);
    expect(impact.counts.charges).toBe(3);
    expect(impact.counts.enRuta).toBe(2 + 1);
    expect(impact.counts.withIncome).toBe(4);
    expect(impact.createdByName).toBe('Ada');
    expect(impact.subsidiaryId).toBe('s1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\PMY\pmy-api && npx jest src/approvals/impact.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (use `count()` with `where` on the plain columns `consolidatedId` / `packageDispatch` FK; `withIncome` counts income rows joined to shipments of the target — implement with a QueryBuilder if needed, but keep it as counts the test can drive; the test injects repos positionally)

```ts
// src/approvals/impact.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consolidated } from 'src/entities/consolidated.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { Income } from 'src/entities/income.entity';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { ApprovalType } from 'src/entities/approval-request.entity';

export interface ImpactSnapshot {
  type: ApprovalType;
  targetId: string;
  label: string;
  createdByName?: string;
  subsidiaryId?: string | null;
  counts: { shipments: number; charges: number; enRuta: number; withIncome: number; devoluciones?: number; hasRouteClosure?: boolean };
}

@Injectable()
export class ApprovalImpactService {
  constructor(
    @InjectRepository(Consolidated) private readonly consRepo: Repository<Consolidated>,
    @InjectRepository(PackageDispatch) private readonly dispatchRepo: Repository<PackageDispatch>,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    @InjectRepository(RouteClosure) private readonly routeClosureRepo: Repository<RouteClosure>,
  ) {}

  async build(type: ApprovalType, targetId: string): Promise<ImpactSnapshot> {
    if (type === 'delete_consolidado') return this.buildConsolidado(targetId);
    return this.buildDispatch(targetId);
  }

  private async buildConsolidado(id: string): Promise<ImpactSnapshot> {
    const c = await this.consRepo.findOne({ where: { id }, relations: ['subsidiary', 'createdBy'] });
    if (!c) throw new NotFoundException('Consolidado no encontrado');
    const shipments = await this.shipmentRepo.count({ where: { consolidatedId: id } as any });
    const shpEnRuta = await this.shipmentRepo.count({ where: { consolidatedId: id, status: 'en_ruta' } as any });
    const charges = await this.chargeRepo.count({ where: { consolidatedId: id } as any });
    const chgEnRuta = await this.chargeRepo.count({ where: { consolidatedId: id, status: 'en_ruta' } as any });
    const withIncome = await this.incomeRepo
      .createQueryBuilder('i')
      .leftJoin('i.shipment', 's')
      .where('s.consolidatedId = :id', { id })
      .getCount()
      .catch(() => 0);
    return {
      type: 'delete_consolidado', targetId: id,
      label: `Consolidado ${c.consNumber ?? id}`,
      createdByName: (c as any).createdBy?.name ?? undefined,
      subsidiaryId: (c as any).subsidiary?.id ?? null,
      counts: { shipments, charges, enRuta: shpEnRuta + chgEnRuta, withIncome },
    };
  }

  private async buildDispatch(id: string): Promise<ImpactSnapshot> {
    const d = await this.dispatchRepo.findOne({ where: { id }, relations: ['subsidiary', 'shipments', 'chargeShipments', 'routeClosure'] });
    if (!d) throw new NotFoundException('Salida a ruta no encontrada');
    const shipments = (d as any).shipments?.length ?? 0;
    const charges = (d as any).chargeShipments?.length ?? 0;
    const hasRouteClosure = !!(d as any).routeClosure;
    const withIncome = await this.incomeRepo
      .createQueryBuilder('i')
      .leftJoin('i.shipment', 's')
      .where('s.packageDispatchId = :id', { id })
      .getCount()
      .catch(() => 0);
    return {
      type: 'delete_route_dispatch', targetId: id,
      label: `Salida a ruta ${(d as any).trackingNumber ?? id}`,
      subsidiaryId: (d as any).subsidiary?.id ?? null,
      counts: { shipments, charges, enRuta: shipments + charges, withIncome, hasRouteClosure },
    };
  }
}
```

> NOTE: verify the real join column names before finalizing — `income.shipment` relation and `shipment.packageDispatch` FK column (`packageDispatchId`). Adjust the QueryBuilder joins to the actual property names (grep `@ManyToOne` in `income.entity.ts` and `shipment.entity.ts`). The test only drives the consolidado counts through mocked `count()`, so the QueryBuilder path is exercised manually.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\PMY\pmy-api && npx jest src/approvals/impact.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/approvals/impact.service.ts src/approvals/impact.service.spec.ts
git commit -m "feat(approvals): ApprovalImpactService con conteos + test"
```

---

### Task B3: `ApprovalsService` (resolve supervisor, create, approve→logical delete, reject, myPending) + tests

**Files:**
- Create: `src/approvals/approvals.service.ts`
- Create: `src/approvals/approvals.service.spec.ts`

**Interfaces:**
- Consumes: `ApprovalImpactService.build` (B2), `NotificationsService.emit` (existing), repos for `ApprovalRequest`, `Subsidiary`, `User`, `Consolidated`, `PackageDispatch`, `Shipment`, `ChargeShipment`.
- Produces:
  - `resolveSupervisor(subsidiaryId?: string|null): Promise<{ id: string; name: string } | null>` — `subsidiary.supervisorUserId` → else first active `superadmin`.
  - `createRequest(input: { type: ApprovalType; targetId: string; actor: ApprovalActor }): Promise<ApprovalRequest>` — validates target exists & is `active`, builds impact, resolves supervisor, inserts `pendiente`, emits `aprobacion.solicitada` to supervisor.
  - `approve(id: string, actor: ApprovalActor): Promise<void>` — guard (actor is assigned approver OR superadmin), execute logical delete, mark `aprobado`, emit `aprobacion.aprobada` to requester.
  - `reject(id, actor, reason): Promise<void>` — guard, mark `rechazado`+reason, emit `aprobacion.rechazada`.
  - `myPending(actor: ApprovalActor): Promise<ApprovalRequest[]>` — where `approverId = actor.userId` and `status='pendiente'`; superadmin sees all pendientes.
- `ApprovalActor = { userId: string; name?: string; role?: string }`.

- [ ] **Step 1: Write failing tests** — cover (a) `resolveSupervisor` fallback, (b) approve of `delete_consolidado` flips `active=false` on consolidated + its shipments + charges and marks the request `aprobado`, (c) approve by a non-approver non-super throws `ForbiddenException`.

```ts
// src/approvals/approvals.service.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

const isSuper = (r?: string) => r === 'superadmin' || r === 'superamin';

function makeSvc(overrides: any = {}) {
  const updated: any = { consolidated: [], shipment: [], charge: [], request: [] };
  const approvalRepo = {
    create: (x: any) => ({ ...x }),
    save: async (x: any) => ({ id: x.id ?? 'req-1', ...x }),
    findOne: async ({ where }: any) => overrides.request ?? { id: where.id, type: 'delete_consolidado', targetId: 'c1', status: 'pendiente', approverId: 'sup-1' },
    update: async (id: any, patch: any) => { updated.request.push({ id, patch }); },
    find: async () => [],
  };
  const subsidiaryRepo = { findOne: async () => overrides.subsidiary ?? { id: 's1', supervisorUserId: overrides.supervisorUserId ?? null } };
  const userRepo = {
    findOne: async ({ where }: any) => {
      if (where?.id === 'sup-1') return { id: 'sup-1', name: 'Sup' };
      if (where?.role) return overrides.superUser ?? { id: 'super-9', name: 'Admin Principal' };
      return null;
    },
  };
  const consRepo = { findOne: async () => ({ id: 'c1', active: true, subsidiary: { id: 's1' } }), update: async (id: any, patch: any) => updated.consolidated.push({ id, patch }) };
  const dispatchRepo = { findOne: async () => ({ id: 'd1', active: true, subsidiary: { id: 's1' } }), update: async (id: any, patch: any) => updated.dispatch = patch };
  const shipmentRepo = { update: async (crit: any, patch: any) => updated.shipment.push({ crit, patch }) };
  const chargeRepo = { update: async (crit: any, patch: any) => updated.charge.push({ crit, patch }) };
  const impact = { build: async () => ({ type: 'delete_consolidado', targetId: 'c1', label: 'Consolidado CONS-1', subsidiaryId: 's1', counts: { shipments: 5, charges: 1, enRuta: 0, withIncome: 0 } }) };
  const notifier = { emit: async () => {} };
  const svc = new ApprovalsService(approvalRepo as any, subsidiaryRepo as any, userRepo as any, consRepo as any, dispatchRepo as any, shipmentRepo as any, chargeRepo as any, impact as any, notifier as any);
  return { svc, updated };
}

describe('ApprovalsService', () => {
  it('resolveSupervisor falls back to first superadmin when subsidiary has none', async () => {
    const { svc } = makeSvc({ supervisorUserId: null });
    const sup = await svc.resolveSupervisor('s1');
    expect(sup?.id).toBe('super-9');
  });

  it('approve of a consolidado logically deletes it and its children', async () => {
    const { svc, updated } = makeSvc();
    await svc.approve('req-1', { userId: 'sup-1', name: 'Sup', role: 'user' });
    expect(updated.consolidated[0].patch.active).toBe(false);
    expect(updated.shipment[0].patch.active).toBe(false);
    expect(updated.charge[0].patch.active).toBe(false);
    expect(updated.request.some((u: any) => u.patch.status === 'aprobado')).toBe(true);
  });

  it('approve throws when actor is neither approver nor superadmin', async () => {
    const { svc } = makeSvc({ request: { id: 'req-1', type: 'delete_consolidado', targetId: 'c1', status: 'pendiente', approverId: 'sup-1' } });
    await expect(svc.approve('req-1', { userId: 'other', role: 'user' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\PMY\pmy-api && npx jest src/approvals/approvals.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

```ts
// src/approvals/approvals.service.ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApprovalRequest, ApprovalType } from 'src/entities/approval-request.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { User } from 'src/entities/user.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ApprovalImpactService } from './impact.service';
import { NotificationsService } from 'src/notifications/notifications.service';

export type ApprovalActor = { userId: string; name?: string; role?: string };
const isSuperRole = (r?: string) => r === 'superadmin' || r === 'superamin';

@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(ApprovalRequest) private readonly repo: Repository<ApprovalRequest>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Consolidated) private readonly consRepo: Repository<Consolidated>,
    @InjectRepository(PackageDispatch) private readonly dispatchRepo: Repository<PackageDispatch>,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
    private readonly impact: ApprovalImpactService,
    private readonly notifier: NotificationsService,
  ) {}

  async resolveSupervisor(subsidiaryId?: string | null): Promise<{ id: string; name: string } | null> {
    if (subsidiaryId) {
      const s = await this.subsidiaryRepo.findOne({ where: { id: subsidiaryId } });
      if (s?.supervisorUserId) {
        const u = await this.userRepo.findOne({ where: { id: s.supervisorUserId } });
        if (u) return { id: u.id, name: [u.name, (u as any).lastName].filter(Boolean).join(' ') || u.email };
      }
    }
    const sup = await this.userRepo.findOne({ where: { role: In(['superadmin', 'superamin']) as any, active: true } as any });
    return sup ? { id: sup.id, name: [sup.name, (sup as any).lastName].filter(Boolean).join(' ') || sup.email } : null;
  }

  private async loadTargetActive(type: ApprovalType, targetId: string): Promise<{ active: boolean; subsidiaryId: string | null }> {
    if (type === 'delete_consolidado') {
      const c = await this.consRepo.findOne({ where: { id: targetId }, relations: ['subsidiary'] });
      if (!c) throw new NotFoundException('Consolidado no encontrado');
      return { active: (c as any).active !== false, subsidiaryId: (c as any).subsidiary?.id ?? null };
    }
    const d = await this.dispatchRepo.findOne({ where: { id: targetId }, relations: ['subsidiary'] });
    if (!d) throw new NotFoundException('Salida a ruta no encontrada');
    return { active: (d as any).active !== false, subsidiaryId: (d as any).subsidiary?.id ?? null };
  }

  async createRequest(input: { type: ApprovalType; targetId: string; actor: ApprovalActor }): Promise<ApprovalRequest> {
    const { type, targetId, actor } = input;
    const target = await this.loadTargetActive(type, targetId);
    if (!target.active) throw new BadRequestException('El elemento ya fue dado de baja.');
    const existing = await this.repo.findOne({ where: { type, targetId, status: 'pendiente' } });
    if (existing) throw new BadRequestException('Ya existe una solicitud pendiente para este elemento.');

    const snapshot = await this.impact.build(type, targetId);
    const supervisor = await this.resolveSupervisor(target.subsidiaryId);
    const row = await this.repo.save(this.repo.create({
      type, targetId,
      subsidiaryId: target.subsidiaryId,
      requestedById: actor.userId,
      requestedByName: actor.name ?? null,
      approverId: supervisor?.id ?? null,
      approverName: supervisor?.name ?? null,
      status: 'pendiente',
      impactSnapshot: snapshot,
    }));

    await this.notifier.emit({
      type: 'aprobacion.solicitada',
      audience: supervisor ? { userId: supervisor.id } : { role: 'superadmin' },
      title: `Autorización requerida: eliminar ${snapshot.label}`,
      body: `${actor.name ?? 'Un usuario'} solicita eliminar ${snapshot.label} (${snapshot.counts.shipments} guías, ${snapshot.counts.charges} cargas).`,
      link: `/?approval=${row.id}`,
      entityId: row.id,
      subsidiaryId: target.subsidiaryId ?? undefined,
      actor: { id: actor.userId, name: actor.name },
      data: { impact: snapshot },
    });
    return row;
  }

  private async loadForDecision(id: string, actor: ApprovalActor): Promise<ApprovalRequest> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status !== 'pendiente') throw new BadRequestException('La solicitud ya fue resuelta.');
    const allowed = isSuperRole(actor.role) || (!!r.approverId && r.approverId === actor.userId);
    if (!allowed) throw new ForbiddenException('No tienes permiso para autorizar esta solicitud.');
    return r;
  }

  private async executeLogicalDelete(r: ApprovalRequest): Promise<void> {
    if (r.type === 'delete_consolidado') {
      await this.consRepo.update(r.targetId, { active: false } as any);
      await this.shipmentRepo.update({ consolidatedId: r.targetId } as any, { active: false } as any);
      await this.chargeRepo.update({ consolidatedId: r.targetId } as any, { active: false } as any);
    } else {
      await this.dispatchRepo.update(r.targetId, { active: false } as any);
    }
  }

  async approve(id: string, actor: ApprovalActor): Promise<void> {
    const r = await this.loadForDecision(id, actor);
    await this.executeLogicalDelete(r);
    await this.repo.update(id, {
      status: 'aprobado',
      approverId: actor.userId,
      approverName: actor.name ?? r.approverName,
      resolvedAt: new Date(),
    });
    const label = (r.impactSnapshot as any)?.label ?? r.targetId;
    await this.notifier.emit({
      type: 'aprobacion.aprobada',
      audience: r.requestedById ? { userId: r.requestedById } : { role: 'superadmin' },
      title: `Autorizado: eliminar ${label}`,
      body: `${actor.name ?? 'El encargado'} autorizó la eliminación de ${label}.`,
      entityId: r.id,
      actor: { id: actor.userId, name: actor.name },
    });
  }

  async reject(id: string, actor: ApprovalActor, reason: string): Promise<void> {
    const r = await this.loadForDecision(id, actor);
    await this.repo.update(id, {
      status: 'rechazado',
      approverId: actor.userId,
      approverName: actor.name ?? r.approverName,
      reason: reason?.trim() || null,
      resolvedAt: new Date(),
    });
    const label = (r.impactSnapshot as any)?.label ?? r.targetId;
    await this.notifier.emit({
      type: 'aprobacion.rechazada',
      audience: r.requestedById ? { userId: r.requestedById } : { role: 'superadmin' },
      title: `Rechazado: eliminar ${label}`,
      body: reason?.trim() || `${actor.name ?? 'El encargado'} rechazó la solicitud.`,
      entityId: r.id,
      actor: { id: actor.userId, name: actor.name },
    });
  }

  async myPending(actor: ApprovalActor): Promise<ApprovalRequest[]> {
    const where: any = isSuperRole(actor.role) ? { status: 'pendiente' } : { status: 'pendiente', approverId: actor.userId };
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async getImpact(type: ApprovalType, targetId: string) {
    const snapshot = await this.impact.build(type, targetId);
    const supervisor = await this.resolveSupervisor(snapshot.subsidiaryId);
    return { ...snapshot, approver: supervisor };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\PMY\pmy-api && npx jest src/approvals/approvals.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/approvals/approvals.service.ts src/approvals/approvals.service.spec.ts
git commit -m "feat(approvals): ApprovalsService (solicitar/aprobar/rechazar/pendientes) + tests"
```

---

### Task B4: Notification catalog types + controller + module

**Files:**
- Modify: `src/notifications/notification-catalog.ts` (add 3 types)
- Create: `src/approvals/approvals.controller.ts`
- Create: `src/approvals/approvals.module.ts`
- Modify: `src/app.module.ts` (register `ApprovalsModule`)

**Interfaces:**
- Consumes: `ApprovalsService` (B3), `ApprovalImpactService` (B2).
- Produces: routes `POST /approvals`, `GET /approvals/mine`, `GET /approvals/impact`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`.

- [ ] **Step 1: Add catalog types** — in `notification-catalog.ts`, inside `CATALOG`, add:

```ts
  // ---- Autorizaciones (borrado con aprobación) ----
  'aprobacion.solicitada': { category: 'operacion', icon: 'gavel',       severity: 'warning', channels: ['bell', 'email'] },
  'aprobacion.aprobada':   { category: 'operacion', icon: 'check-circle', severity: 'info',    channels: ['bell', 'email'] },
  'aprobacion.rechazada':  { category: 'operacion', icon: 'x-circle',     severity: 'warning', channels: ['bell', 'email'] },
```

- [ ] **Step 2: Create the controller**

```ts
// src/approvals/approvals.controller.ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApprovalsService, ApprovalActor } from './approvals.service';
import { ApprovalType } from 'src/entities/approval-request.entity';

@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  private actor(req: any): ApprovalActor {
    return { userId: req.user?.userId, name: req.user?.name, role: req.user?.role };
  }

  @Get('impact')
  impact(@Query('type') type: ApprovalType, @Query('targetId') targetId: string) {
    return this.service.getImpact(type, targetId);
  }

  @Post()
  create(@Body() body: { type: ApprovalType; targetId: string }, @Req() req: any) {
    return this.service.createRequest({ type: body.type, targetId: body.targetId, actor: this.actor(req) });
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.service.myPending(this.actor(req));
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, this.actor(req));
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    return this.service.reject(id, this.actor(req), body?.reason ?? '');
  }
}
```

- [ ] **Step 3: Create the module**

```ts
// src/approvals/approvals.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from 'src/entities/approval-request.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { User } from 'src/entities/user.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { Income } from 'src/entities/income.entity';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ApprovalsService } from './approvals.service';
import { ApprovalImpactService } from './impact.service';
import { ApprovalsController } from './approvals.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApprovalRequest, Subsidiary, User, Consolidated, PackageDispatch, Shipment, ChargeShipment, Income, RouteClosure]),
    NotificationsModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalImpactService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
```

- [ ] **Step 4: Register `ApprovalsModule`** in `app.module.ts` imports. Confirm `NotificationsModule` exports `NotificationsService` (it does per the notifications module).

- [ ] **Step 5: Typecheck**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/notifications/notification-catalog.ts src/approvals/approvals.controller.ts src/approvals/approvals.module.ts src/app.module.ts
git commit -m "feat(approvals): tipos de notificación + controller + módulo registrado"
```

---

### Task B5: Filter `active=true` in consolidado & dispatch read paths

**Files:**
- Modify: `src/consolidated/consolidated.service.ts` (`findAll` @306; and `getShipmentsByConsolidatedId` if it lists shipments)
- Modify: `src/package-dispatch/package-dispatch.service.ts` (its list/find methods)

**Interfaces:** none new. Behavior: soft-deleted rows disappear from operational lists.

- [ ] **Step 1: Consolidated `findAll`** — in the `consolidatedQB` builder (around line 330) add before `.getRawMany()`:

```ts
consolidatedQB.andWhere('c.active = :active', { active: true });
```

- [ ] **Step 2: Consolidated shipments aggregation** — in `getAgg(...)` (around line 370), add to both shipment/charge aggregations:

```ts
.andWhere('t.active = :active', { active: true })
```

(keep the existing `.andWhere('t.status != :cancel', ...)`).

- [ ] **Step 3: Package-dispatch list** — locate the method(s) that return the salidas-a-ruta list (grep `find(` / `createQueryBuilder` in `package-dispatch.service.ts`). Add `active: true` to the `where` (repo `find`) or `.andWhere('<alias>.active = :active', { active: true })` (QueryBuilder). Do NOT filter in `create`/`findOne`-by-id used by the approval flow itself.

- [ ] **Step 4: Typecheck + run existing consolidated/dispatch tests if any**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consolidated/consolidated.service.ts src/package-dispatch/package-dispatch.service.ts
git commit -m "feat(approvals): ocultar consolidados/salidas/guías dadas de baja (active=true)"
```

---

### Task B6: Subsidiary supervisor config endpoint

**Files:**
- Modify: the subsidiaries update service/controller (grep `subsidiary` update endpoint, likely `src/subsidiaries/subsidiaries.controller.ts` + `.service.ts`)

**Interfaces:** `supervisorUserId` becomes settable via the existing subsidiary update endpoint.

- [ ] **Step 1: Allow `supervisorUserId` on update** — ensure the subsidiary update DTO/whitelist includes `supervisorUserId` so `PATCH/PUT /subsidiaries/:id` persists it. If the update uses a class-validator DTO, add `@IsOptional() @IsString() supervisorUserId?: string;`. If it spreads the body directly, no change is needed beyond confirming it isn't stripped.

- [ ] **Step 2: Expose supervisor name for display (optional helper)** — add `GET /subsidiaries/:id` already returns the row incl. `supervisorUserId`; the frontend resolves the name from its users list. No new endpoint required.

- [ ] **Step 3: Typecheck**

Run: `cd C:\PMY\pmy-api && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/subsidiaries/*
git commit -m "feat(approvals): permitir configurar supervisorUserId por sucursal"
```

- [ ] **Step 5: Update the graph**

Run: `cd C:\PMY\pmy-api && graphify update .`

---

### Task B7: Frontend — approvals service + hook

**Files:**
- Create: `C:\PMY\app-pmy\lib\services\approvals.ts`
- Create: `C:\PMY\app-pmy\hooks\services\approvals\use-my-approvals.ts`

**Interfaces:**
- Produces: types `ApprovalType`, `ApprovalImpact`, `ApprovalRequestItem`; functions `getApprovalImpact`, `requestApproval`, `getMyApprovals`, `approveRequest`, `rejectRequest`; hook `useMyApprovals()` → `{ items, count, mutate }`.

- [ ] **Step 1: Create the service**

```ts
// lib/services/approvals.ts
import { api } from "@/lib/api"; // match the client used by lib/services/notifications.ts

export type ApprovalType = "delete_consolidado" | "delete_route_dispatch";

export interface ApprovalImpact {
  type: ApprovalType;
  targetId: string;
  label: string;
  createdByName?: string;
  subsidiaryId?: string | null;
  counts: { shipments: number; charges: number; enRuta: number; withIncome: number; devoluciones?: number; hasRouteClosure?: boolean };
  approver?: { id: string; name: string } | null;
}

export interface ApprovalRequestItem {
  id: string;
  type: ApprovalType;
  targetId: string;
  requestedByName: string | null;
  approverName: string | null;
  status: "pendiente" | "aprobado" | "rechazado";
  reason: string | null;
  impactSnapshot: ApprovalImpact | null;
  createdAt: string;
}

export async function getApprovalImpact(type: ApprovalType, targetId: string): Promise<ApprovalImpact> {
  const { data } = await api.get("/approvals/impact", { params: { type, targetId } });
  return data;
}
export async function requestApproval(type: ApprovalType, targetId: string): Promise<ApprovalRequestItem> {
  const { data } = await api.post("/approvals", { type, targetId });
  return data;
}
export async function getMyApprovals(): Promise<ApprovalRequestItem[]> {
  const { data } = await api.get("/approvals/mine");
  return data;
}
export async function approveRequest(id: string): Promise<void> { await api.post(`/approvals/${id}/approve`); }
export async function rejectRequest(id: string, reason: string): Promise<void> { await api.post(`/approvals/${id}/reject`, { reason }); }
```

> NOTE: match `import { api } ...` to whatever `lib/services/notifications.ts` uses (same client + error handling).

- [ ] **Step 2: Create the hook** (mirror `use-notifications.ts`)

```ts
// hooks/services/approvals/use-my-approvals.ts
import useSWR from "swr";
import { getMyApprovals } from "@/lib/services/approvals";

export function useMyApprovals() {
  const { data, isLoading, mutate } = useSWR(
    "approvals-mine",
    () => getMyApprovals(),
    { refreshInterval: 30000, revalidateOnFocus: true, keepPreviousData: true },
  );
  const items = data ?? [];
  return { items, count: items.length, isLoading, mutate };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/services/approvals.ts hooks/services/approvals/use-my-approvals.ts
git commit -m "feat(approvals): servicio y hook de aprobaciones (frontend)"
```

---

### Task B8: Frontend — `DeleteRequestDialog` (impact + request)

**Files:**
- Create: `C:\PMY\app-pmy\components\approvals\delete-request-dialog.tsx`

**Interfaces:**
- Consumes: `getApprovalImpact`, `requestApproval` (B7).
- Produces: `<DeleteRequestDialog open onOpenChange type targetId onRequested />`.

- [ ] **Step 1: Build the dialog** (shadcn `Dialog`, `Button`, `Badge`; lucide `AlertTriangle`, `Loader2`)

```tsx
// components/approvals/delete-request-dialog.tsx
"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner"; // match the toast the app already uses
import { ApprovalImpact, ApprovalType, getApprovalImpact, requestApproval } from "@/lib/services/approvals";

export function DeleteRequestDialog({
  open, onOpenChange, type, targetId, onRequested,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  type: ApprovalType;
  targetId: string;
  onRequested?: () => void;
}) {
  const [impact, setImpact] = useState<ApprovalImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !targetId) return;
    setImpact(null); setLoading(true);
    getApprovalImpact(type, targetId)
      .then(setImpact)
      .catch(() => toast.error("No se pudo calcular el impacto"))
      .finally(() => setLoading(false));
  }, [open, type, targetId]);

  const submit = async () => {
    setSending(true);
    try {
      await requestApproval(type, targetId);
      toast.success(`Solicitud enviada${impact?.approver?.name ? ` a ${impact.approver.name}` : ""}`);
      onRequested?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "No se pudo enviar la solicitud");
    } finally { setSending(false); }
  };

  const c = impact?.counts;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" /> Solicitar eliminación
          </DialogTitle>
          <DialogDescription>
            La baja requiere autorización del encargado de sucursal. Es una baja lógica (reversible en base de datos).
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculando impacto…</div>}

        {impact && !loading && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{impact.label}</p>
            {impact.createdByName && <p className="text-muted-foreground">Creado por: <span className="font-medium text-foreground">{impact.createdByName}</span></p>}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Guías" value={c!.shipments} />
              <Stat label="Cargas" value={c!.charges} />
              <Stat label="En ruta" value={c!.enRuta} warn={c!.enRuta > 0} />
              <Stat label="Con ingresos" value={c!.withIncome} warn={c!.withIncome > 0} />
            </div>
            {c!.hasRouteClosure && <p className="rounded bg-amber-50 px-2 py-1 text-amber-700">Tiene cierre de ruta asociado.</p>}
            <p className="text-muted-foreground">Se pedirá autorización a: <span className="font-medium text-foreground">{impact.approver?.name ?? "Admin Principal"}</span></p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} disabled={sending || loading || !impact}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Solicitar eliminación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? "border-amber-300 bg-amber-50" : "bg-muted/40"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${warn ? "text-amber-700" : ""}`}>{value}</div>
    </div>
  );
}
```

> NOTE: match the toast import (`sonner` vs the app's `sileo-toaster`) to what other dialogs use.

- [ ] **Step 2: Typecheck**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/approvals/delete-request-dialog.tsx
git commit -m "feat(approvals): DeleteRequestDialog con resumen de impacto"
```

---

### Task B9: Frontend — `ApprovalTray` in the top bar

**Files:**
- Create: `C:\PMY\app-pmy\components\approvals\approval-tray.tsx`
- Modify: `C:\PMY\app-pmy\components\app-layout.tsx` (mount `<ApprovalTray/>` just before `<NotificationBell/>` at line ~298)

**Interfaces:**
- Consumes: `useMyApprovals` (B7), `approveRequest`, `rejectRequest` (B7).

- [ ] **Step 1: Build the tray** (shadcn `Popover`, `ScrollArea`, `Button`, `Textarea`; lucide `Inbox` already imported in app-layout). Badge + empty-state mirror `NotificationBell`. Only renders its trigger when `count > 0` OR the user could be an approver; simplest: always render, hide badge when `count === 0`. Each item shows impact counts and Aprobar / Rechazar (Rechazar opens an inline `Textarea` for the reason).

```tsx
// components/approvals/approval-tray.tsx
"use client";
import { useState } from "react";
import { Inbox, Check, X, Loader2, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useMyApprovals } from "@/hooks/services/approvals/use-my-approvals";
import { approveRequest, rejectRequest, ApprovalRequestItem } from "@/lib/services/approvals";

export function ApprovalTray() {
  const { items, count, mutate } = useMyApprovals();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const doApprove = async (r: ApprovalRequestItem) => {
    setBusyId(r.id);
    try { await approveRequest(r.id); toast.success("Autorizado y eliminado"); mutate(); }
    catch (e: any) { toast.error(e?.response?.data?.message || "No se pudo autorizar"); }
    finally { setBusyId(null); }
  };
  const doReject = async (r: ApprovalRequestItem) => {
    setBusyId(r.id);
    try { await rejectRequest(r.id, reason); toast.success("Solicitud rechazada"); setRejecting(null); setReason(""); mutate(); }
    catch (e: any) { toast.error(e?.response?.data?.message || "No se pudo rechazar"); }
    finally { setBusyId(null); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full hover:bg-muted" aria-label="Autorizaciones">
          <Inbox className={count > 0 ? "h-5 w-5 text-amber-600" : "h-5 w-5"} />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] h-[18px] place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[400px] overflow-hidden rounded-xl p-0 shadow-xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white"><Inbox className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-semibold leading-tight">Autorizaciones</p>
            <p className="text-[11px] text-muted-foreground">{count > 0 ? `${count} pendiente(s)` : "Nada pendiente 🎉"}</p>
          </div>
        </div>
        <ScrollArea className="max-h-[420px]">
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-muted"><Inbox className="h-7 w-7 opacity-40" /></span>
              <span className="text-sm font-medium">Sin solicitudes</span>
            </div>
          )}
          <div className="divide-y">
            {items.map((r) => {
              const s = r.impactSnapshot;
              return (
                <div key={r.id} className="px-4 py-3 text-sm">
                  <p className="font-medium">{s?.label ?? r.targetId}</p>
                  <p className="text-[12px] text-muted-foreground">Solicitó: {r.requestedByName ?? "—"}</p>
                  {s?.counts && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      <Chip>{s.counts.shipments} guías</Chip>
                      <Chip>{s.counts.charges} cargas</Chip>
                      {s.counts.enRuta > 0 && <Chip warn>{s.counts.enRuta} en ruta</Chip>}
                      {s.counts.withIncome > 0 && <Chip warn>{s.counts.withIncome} con ingresos</Chip>}
                    </div>
                  )}
                  {rejecting === r.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo del rechazo" className="min-h-[60px]" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => doReject(r)}>
                          {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar rechazo"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setRejecting(null); setReason(""); }}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busyId === r.id} onClick={() => doApprove(r)}>
                        {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1 h-4 w-4" /> Aprobar</>}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r.id)}><X className="mr-1 h-4 w-4" /> Rechazar</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <span className={`rounded-full px-1.5 py-0.5 font-medium ${warn ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{children}</span>;
}
```

- [ ] **Step 2: Mount in `app-layout.tsx`** — add `import { ApprovalTray } from "./approvals/approval-tray";` and render `<ApprovalTray />` immediately before `<NotificationBell />` (line ~298).

- [ ] **Step 3: Typecheck**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/approvals/approval-tray.tsx components/app-layout.tsx
git commit -m "feat(approvals): bandeja de autorización en la barra superior"
```

---

### Task B10: Frontend — delete buttons on consolidado & salida a ruta + supervisor selector in config

**Files:**
- Modify: consolidados list/detail (`app/operaciones/consolidados/columns.tsx` or the detail component) — add "Eliminar" action opening `DeleteRequestDialog` with `type="delete_consolidado"`.
- Modify: salidas a ruta list — add "Eliminar" action with `type="delete_route_dispatch"`.
- Modify: subsidiary config screen — add a "Encargado/Supervisor" select bound to `supervisorUserId`.

**Interfaces:** Consumes `DeleteRequestDialog` (B8), subsidiary update service (B6).

- [ ] **Step 1: Consolidado delete action** — add a `Trash2` action (shadcn `DropdownMenuItem` or icon `Button`) in the consolidados row/detail. It sets local state `{deleteId}` and renders `<DeleteRequestDialog open type="delete_consolidado" targetId={deleteId} onRequested={refetch} />`. Gate visibility to authenticated operational users (all can request).

- [ ] **Step 2: Salida a ruta delete action** — same pattern in the salidas-a-ruta list with `type="delete_route_dispatch"`.

- [ ] **Step 3: Supervisor selector in config** — in the subsidiary edit form, add a shadcn `Select` (or combobox) listing users (reuse the users service already used elsewhere), bound to `supervisorUserId`, saved through the existing subsidiary update call. Label "Encargado/Supervisor (autoriza borrados)".

- [ ] **Step 4: Typecheck**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/operaciones/consolidados/* app/operaciones/salidas* components/package-dispatch/* app/configuracion/* components/configuracion/*
git commit -m "feat(approvals): botones Eliminar (consolidado/salida) + selector de supervisor por sucursal"
```

---

# FEATURE A — Experimental FedEx paste import

### Task A1: `PasteImportModal` component

**Files:**
- Create: `C:\PMY\app-pmy\components\import-components\paste-import-modal.tsx`

**Interfaces:**
- Consumes existing services in `lib/services/shipments.ts`: `uploadShipmentFile` (`/shipments/upload`), `previewShipmentFile` (`/shipments/upload/preview`), `uploadShipmentPayments` (`/shipments/upload-payment`), `uploadHighValueShipments` (`/shipments/upload-hv`), `uploadF2ChargeShipments` (`/shipments/upload-charge`), plus SheetJS `xlsx`.
- Produces `<PasteImportModal open onOpenChange subsidiaryId />`.

Behavior: user picks type (Aéreo/Master · Pagos · Alto Valor · F2), pastes TSV from Excel into a `<textarea>`; component parses lines → matrix (split `\n` then `\t`), shows a preview table of the first rows, builds an `.xlsx` File in memory (same as `buildWorkbook` in `import-dhl-text-modal.tsx`), then calls the matching upload service. For Master, run `previewShipmentFile` first and show duplicates/consNumber conflict before confirming.

- [ ] **Step 1: Open `import-dhl-text-modal.tsx`** and copy its `buildWorkbook` helper + upload-invocation shape as the template. Reuse the exact File/Blob construction it uses so the generated `.xlsx` matches what the backend parsers expect (headers on row 1).

- [ ] **Step 2: Build the component** with:
  - `type` state and a shadcn `Select`/`Tabs` for the 4 kinds.
  - `raw` textarea; a derived `rows = raw.trim().split(/\r?\n/).map(l => l.split("\t"))`.
  - Preview: a shadcn `Table` of the first ~10 rows.
  - `consNumber`, `consDate`, `subsidiaryId` inputs where the corresponding upload requires them (Master/F2 need subsidiary + consNumber + consDate; Payment needs consNumber; HV per its service signature).
  - `buildXlsx(rows): File` — worksheet from the matrix (first row = headers), workbook → array buffer → `File([buf], "pegado.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })`.
  - Submit: for Master call preview then `uploadShipmentFile(file, {subsidiaryId, consNumber, consDate, isAereo})`; for the others call the matching service. Show success/error toast with saved/duplicated/failed counts.

- [ ] **Step 3: Typecheck**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/import-components/paste-import-modal.tsx
git commit -m "feat(paste-import): modal experimental para pegar datos FedEx desde Excel"
```

---

### Task A2: Experimental button in Envíos (gated to superadmin + flag)

**Files:**
- Modify: `C:\PMY\app-pmy\app\operaciones\envios\page.tsx`

**Interfaces:** Consumes `PasteImportModal` (A1), `useAuthStore` for role.

- [ ] **Step 1: Add the gate + button** — near the existing import buttons in `envios/page.tsx`:

```tsx
const { user } = useAuthStore();
const showPaste = (user?.role === "superadmin" || user?.role === "superamin")
  && process.env.NEXT_PUBLIC_EXPERIMENTAL_PASTE === "1";
const [pasteOpen, setPasteOpen] = useState(false);
// ...
{showPaste && (
  <Button variant="outline" onClick={() => setPasteOpen(true)}>
    <ClipboardPaste className="mr-2 h-4 w-4" /> Pegar (experimental)
  </Button>
)}
<PasteImportModal open={pasteOpen} onOpenChange={setPasteOpen} subsidiaryId={selectedSubsidiaryId} />
```

(import `ClipboardPaste` from lucide-react; wire `subsidiaryId` from whatever the page already uses for the FedEx wizard.)

- [ ] **Step 2: Add the flag** — document `NEXT_PUBLIC_EXPERIMENTAL_PASTE=1` in `.env.local` for dev (do NOT set it in production env). Note it in the PR description.

- [ ] **Step 3: Typecheck + quick browser check**

Run: `cd C:\PMY\app-pmy && npx tsc --noEmit`
Then (optional) run the app and confirm the button appears only for superadmin with the flag on, and that pasting a small master sample creates shipments.

- [ ] **Step 4: Commit**

```bash
git add app/operaciones/envios/page.tsx
git commit -m "feat(paste-import): botón experimental en Envíos (superadmin + flag)"
```

- [ ] **Step 5: Update the graph (frontend has none; backend already updated in B6)** — no action.

---

## Self-Review

**Spec coverage:**
- Tarea 1 (pegar FedEx) → A1, A2. Cubre los 4 tipos (Aéreo/Pagos/Alto Valor/F2), reúso de endpoints + preview, botón experimental gated. ✅
- Tarea 2 (borrado con aprobación + bandeja) → B1–B10. Supervisor por sucursal + fallback superadmin (B1/B3/B6/B10), solicitud por cualquier usuario con impacto y nombre del encargado (B2/B8), baja lógica active=false consolidado+hijos y salida a ruta (B1/B3/B5), bandeja en barra superior (B9), aprobar/rechazar con motivo (B3/B9), notificación campana+email (B3/B4). ✅
- Tarea 3 (archivo + nombre FedEx) → C1–C5. Tabla dedicada `import_file` con todas las columnas ligada al upload (C1–C4), archivo en disco, descarga, detalle de consolidado + historial Importaciones (C5), solo FedEx (C4). ✅
- Fuera de alcance respetado: pegar no guarda archivo (A no llama a import-files); DHL sin cambios; sin reversión de estatus EN_RUTA (B3 solo active=false). ✅

**Placeholder scan:** Backend code is complete and typed. Frontend page-wiring tasks (C5, B10, A2) include full new-component code; page insertions carry explicit snippets + "open file X, copy pattern Y" notes because exact surrounding JSX must be read at edit time — acceptable, not placeholders.

**Type consistency:** `ImportFileKind` = `'master'|'payment'|'high_value'|'f2'` used consistently (C1/C2/C4/C5). `ApprovalType` = `'delete_consolidado'|'delete_route_dispatch'` and `ImpactSnapshot`/`ApprovalImpact` counts shape `{shipments,charges,enRuta,withIncome,devoluciones?,hasRouteClosure?}` consistent across B2/B3/B7/B8/B9. `ApprovalActor = {userId,name?,role?}` consistent B3/B4. Notification types `aprobacion.solicitada|aprobada|rechazada` consistent B3/B4.

**Open verification points flagged inline (implementer must confirm at edit time):** the HTTP client import name in `lib/services/*`; the toast library; `income.shipment` relation + `shipment.packageDispatchId` join column names (B2); the package-dispatch list method name (B5); the subsidiary update whitelist (B6); the FedEx service methods' return shape for `rowCount` (C4).
