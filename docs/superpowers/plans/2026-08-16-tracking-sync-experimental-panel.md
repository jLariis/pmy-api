# Tracking-Sync Experimental Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin "Experimental" panel that compares our stored FedEx statuses against FedEx live (by tracking / route / consolidated) and lets a superadmin correct them on demand — status-only, idempotent, audited.

**Architecture:** Backend (`pmy-api`) reuses the merged sync engine (`FedexTrackingSource`, `TrackingNormalizer`, `EventReconciler`, `SyncRulesPipeline`) behind a read-only `TrackingCompareService` and a write `PersistentSyncSink`, exposed by a superadmin-guarded `TrackingSyncController`. Frontend (`app-pmy`) adds a page under `app/dev/tracking-sync/` with a comparison table and a "Corregir ahora" flow.

**Tech Stack:** NestJS + TypeORM + Jest (pmy-api); Next.js (App Router) + Vitest (app-pmy).

## Global Constraints

- **Two repos.** Backend tasks run in `C:\PMY\pmy-api` (Jest: `npx jest <frag> --runInBand`). Frontend tasks run in `C:\PMY\app-pmy` (Vitest: `npx vitest run <frag>`). Each repo has its own git — commit in the repo the task touches.
- **Correction is status-only.** Apply writes `shipment.status` + missing `shipment_status` rows. It NEVER generates incomes/cobros (legacy cron keeps doing that).
- **Idempotent writes.** Dedup by `shadowKey` (`timestampMs|exceptionCode|status`) against existing history; re-applying inserts nothing new.
- **Superadmin only.** Backend: `@UseGuards(SuperAdminGuard)` from `src/audit/super-admin.guard.ts`. Frontend: menu item gated by superadmin role, production-visible (mirror the `monitoreoRutasItem` pattern in `components/app-sidebar.tsx`, NOT the `IS_DEV` gate).
- **No `next dev`.** Verify frontend with Vitest + `npx tsc --noEmit` only (8GB dev machine; avoid Next OOM).
- **Reuse, don't fork.** Engine providers live in `TrackingSyncModule` (`src/tracking-sync/`). Do NOT touch `shipments.service.ts`.
- **Phases:** A = compare (read-only, Tasks 1–3, 6–8). B = correction (write, Tasks 4–5, 9). Phase A is shippable alone.

---

## File Structure

**Backend (`pmy-api`):**
- `src/tracking-sync/compare.types.ts` — `NormalizedEventDto`, `CompareResult`, `ApplyOutcome`.
- `src/tracking-sync/tracking-compare.service.ts` — read-only compare (by tracking/route/consolidated).
- `src/tracking-sync/sinks/persistent-sync.sink.ts` — write path (TX, idempotent, audited).
- `src/tracking-sync/tracking-sync.controller.ts` — superadmin endpoints.
- Modify `src/tracking-sync/tracking-sync.module.ts` — register controller + new providers + repos + AuditModule/AuditService access.

**Frontend (`app-pmy`):**
- `lib/services/tracking-sync.ts` — typed API client.
- `lib/tracking/compare-summary.ts` — pure helper (summary + row classification).
- `lib/tracking/compare-summary.test.ts` — Vitest.
- `app/dev/tracking-sync/page.tsx` — the panel.
- `components/tracking-sync/compare-table.tsx` — table + row expand + (Phase B) correct button/modal.
- Modify `components/app-sidebar.tsx` — superadmin-gated menu entry.

---

## Task 1: Backend — CompareResult DTOs + `compareByTracking`

**Repo:** `pmy-api`

**Files:**
- Create: `src/tracking-sync/compare.types.ts`
- Create: `src/tracking-sync/tracking-compare.service.ts`
- Test: `src/tracking-sync/tracking-compare.service.spec.ts`

**Interfaces:**
- Consumes: `FedexTrackingSource.fetch(refs)`, `TrackingNormalizer.normalize(raw)`, `EventReconciler.reconcile(normalized, knownKeys, currentStatus, keyOf)`, `SyncRulesPipeline.run(ctx)`, `buildShadowKey`, `Shipment`/`ShipmentStatus` repos.
- Produces: `NormalizedEventDto`, `CompareResult`, `ApplyOutcome` (types); `TrackingCompareService.compareByTracking(trackingNumber): Promise<CompareResult>`.

- [ ] **Step 1: Write the types file**

```ts
// src/tracking-sync/compare.types.ts
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

export interface NormalizedEventDto {
  occurredAt: string; // ISO
  status: ShipmentStatusType;
  derivedCode: string | null;
  exceptionCode: string | null;
  description: string | null;
  location: string | null;
}

export interface CompareResult {
  shipmentId: string;
  trackingNumber: string;
  ourStatus: ShipmentStatusType;
  ourLastEventAt: string | null;
  fedexStatus: ShipmentStatusType | null;
  fedexLastEventAt: string | null;
  diverges: boolean;
  isStale: boolean;
  missingEvents: NormalizedEventDto[];
  fedexEvents: NormalizedEventDto[];
  issues: string[];
  error?: string;
}

export interface ApplyOutcome {
  shipmentId: string;
  trackingNumber: string;
  applied: boolean;
  fromStatus: ShipmentStatusType;
  toStatus: ShipmentStatusType | null;
  insertedEvents: number;
  skippedReason?: string;
  error?: string;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/tracking-sync/tracking-compare.service.spec.ts
import { TrackingCompareService } from './tracking-compare.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { buildShadowKey } from './event-key.util';

function makeService(over: {
  shipment: any;
  historyRows: any[];
  normalized: any;
}) {
  const shipmentRepo = {
    findOne: jest.fn().mockResolvedValue(over.shipment),
    createQueryBuilder: jest.fn(),
  } as any;
  const statusRepo = { find: jest.fn().mockResolvedValue(over.historyRows) } as any;
  const source = { fetch: jest.fn().mockResolvedValue([{ trackingNumber: over.shipment.trackingNumber, trackResults: [{}] }]) } as any;
  const normalizer = { normalize: jest.fn().mockReturnValue(over.normalized) } as any;
  // Reconciler real-ish: filters by shadowKey.
  const reconciler = {
    reconcile: (normalized: any, known: Set<string>, current: any, keyOf: any) => ({
      newEvents: normalized.events.filter((e: any) => !known.has(keyOf(e))),
      proposedStatus: normalized.latest ? normalized.latest.status : null,
      currentStatus: current,
      transition: null,
    }),
  } as any;
  const pipeline = { run: jest.fn().mockImplementation(async (ctx: any) => { /* no-op: keep proposedStatus */ }) } as any;
  return new TrackingCompareService(shipmentRepo, statusRepo, source, normalizer, reconciler, pipeline);
}

describe('TrackingCompareService.compareByTracking', () => {
  it('flags divergence, staleness and missing events', async () => {
    const ourTs = new Date('2026-08-12T09:00:00Z');
    const fedexTs = new Date('2026-08-14T20:00:00Z');
    const known = { occurredAt: ourTs, status: ShipmentStatusType.EN_RUTA, exceptionCode: null, derivedCode: 'IT', eventType: 'IT', description: 'x', location: 'Hmo', eventKey: 'k-old', shadowKey: buildShadowKey(ourTs.getTime(), null, ShipmentStatusType.EN_RUTA) };
    const fresh = { occurredAt: fedexTs, status: ShipmentStatusType.ENTREGADO, exceptionCode: null, derivedCode: 'DL', eventType: 'DL', description: 'Delivered', location: 'Hmo', eventKey: 'k-new', shadowKey: buildShadowKey(fedexTs.getTime(), null, ShipmentStatusType.ENTREGADO) };

    const svc = makeService({
      shipment: { id: 's1', trackingNumber: 'TN1', status: ShipmentStatusType.EN_RUTA },
      historyRows: [{ timestamp: ourTs, exceptionCode: null, status: ShipmentStatusType.EN_RUTA }],
      normalized: { trackingNumber: 'TN1', events: [known, fresh], latest: fresh, commitDateTime: null, validation: { ok: true, issues: [] } },
    });

    const r = await svc.compareByTracking('TN1');
    expect(r.ourStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(r.fedexStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(r.diverges).toBe(true);
    expect(r.isStale).toBe(true);
    expect(r.missingEvents).toHaveLength(1);
    expect(r.missingEvents[0].status).toBe(ShipmentStatusType.ENTREGADO);
    expect(r.ourLastEventAt).toBe(ourTs.toISOString());
    expect(r.fedexLastEventAt).toBe(fedexTs.toISOString());
  });

  it('returns error when the shipment is not found', async () => {
    const svc = makeService({ shipment: null, historyRows: [], normalized: { events: [], latest: null, validation: { ok: false, issues: [] } } } as any);
    const r = await svc.compareByTracking('NOPE');
    expect(r.error).toBeDefined();
    expect(r.fedexStatus).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tracking-sync/tracking-compare.service.spec --runInBand`
Expected: FAIL — cannot find module `./tracking-compare.service`.

- [ ] **Step 4: Write the implementation**

```ts
// src/tracking-sync/tracking-compare.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { buildShadowKey } from './event-key.util';
import { NormalizedEvent, NormalizedTracking, SyncContext } from './tracking-sync.types';
import { CompareResult, NormalizedEventDto } from './compare.types';

/**
 * Servicio READ-ONLY de comparación en vivo: contrasta nuestro estado almacenado
 * contra el último estado real de FedEx. No escribe nada.
 */
@Injectable()
export class TrackingCompareService {
  private readonly logger = new Logger(TrackingCompareService.name);

  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ShipmentStatus) private readonly statusRepo: Repository<ShipmentStatus>,
    private readonly source: FedexTrackingSource,
    private readonly normalizer: TrackingNormalizer,
    private readonly reconciler: EventReconciler,
    private readonly pipeline: SyncRulesPipeline,
  ) {}

  async compareByTracking(trackingNumber: string): Promise<CompareResult> {
    const shipment = await this.shipmentRepo.findOne({
      where: { trackingNumber },
      relations: ['subsidiary'],
      order: { createdAt: 'DESC' },
    });
    if (!shipment) {
      return this.emptyResult(trackingNumber, null, 'Guía no encontrada en el sistema');
    }
    return this.compareShipment(shipment);
  }

  /** Núcleo reutilizable: compara un shipment ya cargado. */
  async compareShipment(shipment: Shipment): Promise<CompareResult> {
    try {
      const [raw] = await this.source.fetch([
        { trackingNumber: shipment.trackingNumber, fedexUniqueId: shipment.fedexUniqueId, carrierCode: shipment.carrierCode },
      ]);
      if (!raw || raw.trackResults.length === 0) {
        return this.emptyResult(shipment.trackingNumber, shipment, 'Sin datos en FedEx');
      }

      const normalized = this.normalizer.normalize(raw);
      const rows = await this.statusRepo.find({
        where: { shipment: { id: shipment.id } },
        select: ['timestamp', 'exceptionCode', 'status'],
      });
      const knownKeys = new Set(
        rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)),
      );
      const ourLastEventAt = rows.length
        ? new Date(Math.max(...rows.map((r) => new Date(r.timestamp).getTime()))).toISOString()
        : null;

      const reconcile = this.reconciler.reconcile(
        normalized, knownKeys, shipment.status, (e: NormalizedEvent) => e.shadowKey,
      );

      const ctx: SyncContext = {
        shipment, normalized, reconcile,
        proposedStatus: reconcile.proposedStatus,
        vetoedEventKeys: new Set<string>(), deferredEffects: [], notes: [],
      };
      await this.pipeline.run(ctx);

      const fedexLastEventAt = normalized.latest ? normalized.latest.occurredAt.toISOString() : null;
      const diverges = ctx.proposedStatus != null && ctx.proposedStatus !== shipment.status;
      const isStale = !!fedexLastEventAt && (ourLastEventAt == null || fedexLastEventAt > ourLastEventAt);

      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        ourStatus: shipment.status,
        ourLastEventAt,
        fedexStatus: ctx.proposedStatus,
        fedexLastEventAt,
        diverges,
        isStale,
        missingEvents: reconcile.newEvents.map(this.toDto),
        fedexEvents: normalized.events.map(this.toDto),
        issues: normalized.validation.issues,
      };
    } catch (err: any) {
      this.logger.warn(`compareShipment ${shipment.trackingNumber}: ${err?.message}`);
      return this.emptyResult(shipment.trackingNumber, shipment, err?.message ?? 'Error consultando FedEx');
    }
  }

  private toDto(e: NormalizedEvent): NormalizedEventDto {
    return {
      occurredAt: e.occurredAt.toISOString(),
      status: e.status,
      derivedCode: e.derivedCode,
      exceptionCode: e.exceptionCode,
      description: e.description,
      location: e.location,
    };
  }

  private emptyResult(trackingNumber: string, shipment: Shipment | null, error: string): CompareResult {
    return {
      shipmentId: shipment?.id ?? '',
      trackingNumber,
      ourStatus: shipment?.status ?? ShipmentStatusType.DESCONOCIDO,
      ourLastEventAt: null,
      fedexStatus: null,
      fedexLastEventAt: null,
      diverges: false,
      isStale: false,
      missingEvents: [],
      fedexEvents: [],
      issues: [error],
      error,
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tracking-sync/tracking-compare.service.spec --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tracking-sync/compare.types.ts src/tracking-sync/tracking-compare.service.ts src/tracking-sync/tracking-compare.service.spec.ts
git commit -m "feat(tracking-sync): read-only live compare service (by tracking)"
```

---

## Task 2: Backend — `compareByRoute` + `compareByConsolidated`

**Repo:** `pmy-api`

**Files:**
- Modify: `src/tracking-sync/tracking-compare.service.ts`
- Test: `src/tracking-sync/tracking-compare.service.spec.ts` (add cases)

**Interfaces:**
- Produces: `TrackingCompareService.compareByRoute(routeId): Promise<CompareResult[]>`, `TrackingCompareService.compareByConsolidated(consolidatedId): Promise<CompareResult[]>`.

- [ ] **Step 1: Write the failing tests (add to the existing spec)**

```ts
// append inside src/tracking-sync/tracking-compare.service.spec.ts

describe('TrackingCompareService batch loaders', () => {
  function svcWithShipments(shipments: any[]) {
    const shipmentRepo = {
      find: jest.fn().mockResolvedValue(shipments),
      findOne: jest.fn(),
    } as any;
    const statusRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const source = { fetch: jest.fn().mockResolvedValue(shipments.map((s) => ({ trackingNumber: s.trackingNumber, trackResults: [] }))) } as any;
    const normalizer = { normalize: jest.fn().mockReturnValue({ events: [], latest: null, validation: { ok: false, issues: [] } }) } as any;
    const reconciler = { reconcile: jest.fn().mockReturnValue({ newEvents: [], proposedStatus: null, currentStatus: null, transition: null }) } as any;
    const pipeline = { run: jest.fn().mockResolvedValue(undefined) } as any;
    return { svc: new (require('./tracking-compare.service').TrackingCompareService)(shipmentRepo, statusRepo, source, normalizer, reconciler, pipeline), shipmentRepo };
  }

  it('compareByRoute loads shipments by routeId and returns one result each', async () => {
    const { svc, shipmentRepo } = svcWithShipments([
      { id: 's1', trackingNumber: 'TN1', status: 'en_ruta' },
      { id: 's2', trackingNumber: 'TN2', status: 'en_ruta' },
    ]);
    const results = await svc.compareByRoute('route-1');
    expect(results).toHaveLength(2);
    expect(shipmentRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { packageDispatch: { id: 'route-1' } } }));
  });

  it('compareByConsolidated loads shipments by consolidatedId', async () => {
    const { svc, shipmentRepo } = svcWithShipments([{ id: 's3', trackingNumber: 'TN3', status: 'pendiente' }]);
    const results = await svc.compareByConsolidated('cons-1');
    expect(results).toHaveLength(1);
    expect(shipmentRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { consolidatedId: 'cons-1' } }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tracking-sync/tracking-compare.service.spec --runInBand`
Expected: FAIL — `compareByRoute`/`compareByConsolidated` are not functions.

- [ ] **Step 3: Add the methods**

```ts
// add to TrackingCompareService (uses this.shipmentRepo + this.compareShipment)

  async compareByRoute(routeId: string): Promise<CompareResult[]> {
    const shipments = await this.shipmentRepo.find({
      where: { packageDispatch: { id: routeId } },
      relations: ['subsidiary'],
    });
    return this.compareMany(shipments);
  }

  async compareByConsolidated(consolidatedId: string): Promise<CompareResult[]> {
    const shipments = await this.shipmentRepo.find({
      where: { consolidatedId },
      relations: ['subsidiary'],
    });
    return this.compareMany(shipments);
  }

  private async compareMany(shipments: Shipment[]): Promise<CompareResult[]> {
    const out: CompareResult[] = [];
    for (const s of shipments) {
      out.push(await this.compareShipment(s));
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/tracking-compare.service.spec --runInBand`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/tracking-compare.service.ts src/tracking-sync/tracking-compare.service.spec.ts
git commit -m "feat(tracking-sync): compare by route and by consolidated"
```

---

## Task 3: Backend — Controller (compare endpoints) + module wiring

**Repo:** `pmy-api`

**Files:**
- Create: `src/tracking-sync/tracking-sync.controller.ts`
- Modify: `src/tracking-sync/tracking-sync.module.ts`
- Test: `src/tracking-sync/tracking-sync.controller.spec.ts`

**Interfaces:**
- Consumes: `TrackingCompareService`, `SuperAdminGuard` (`src/audit/super-admin.guard.ts`).
- Produces: `TrackingSyncController` with `GET compare/tracking/:trackingNumber`, `GET compare/route/:routeId`, `GET compare/consolidated/:consolidatedId`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/tracking-sync.controller.spec.ts
import { TrackingSyncController } from './tracking-sync.controller';

describe('TrackingSyncController (compare)', () => {
  const compare = {
    compareByTracking: jest.fn().mockResolvedValue({ trackingNumber: 'TN1' }),
    compareByRoute: jest.fn().mockResolvedValue([]),
    compareByConsolidated: jest.fn().mockResolvedValue([]),
  } as any;
  const ctrl = new TrackingSyncController(compare, {} as any);

  it('delegates compare/tracking', async () => {
    await ctrl.compareTracking('TN1');
    expect(compare.compareByTracking).toHaveBeenCalledWith('TN1');
  });
  it('delegates compare/route', async () => {
    await ctrl.compareRoute('r1');
    expect(compare.compareByRoute).toHaveBeenCalledWith('r1');
  });
  it('delegates compare/consolidated', async () => {
    await ctrl.compareConsolidated('c1');
    expect(compare.compareByConsolidated).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/tracking-sync.controller.spec --runInBand`
Expected: FAIL — cannot find module `./tracking-sync.controller`.

- [ ] **Step 3: Write the controller**

```ts
// src/tracking-sync/tracking-sync.controller.ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { TrackingCompareService } from './tracking-compare.service';
import { PersistentSyncSink } from './sinks/persistent-sync.sink';

/**
 * Panel experimental (solo superadmin): comparación en vivo contra FedEx y corrección
 * manual de estatus. Read-only salvo POST /apply.
 */
@ApiTags('tracking-sync')
@UseGuards(SuperAdminGuard)
@Controller('tracking-sync')
export class TrackingSyncController {
  constructor(
    private readonly compare: TrackingCompareService,
    private readonly persistentSink: PersistentSyncSink,
  ) {}

  @Get('compare/tracking/:trackingNumber')
  @ApiOperation({ summary: 'Compara una guía contra FedEx (en vivo)' })
  compareTracking(@Param('trackingNumber') trackingNumber: string) {
    return this.compare.compareByTracking(trackingNumber);
  }

  @Get('compare/route/:routeId')
  @ApiOperation({ summary: 'Compara todas las guías de una salida a ruta' })
  compareRoute(@Param('routeId') routeId: string) {
    return this.compare.compareByRoute(routeId);
  }

  @Get('compare/consolidated/:consolidatedId')
  @ApiOperation({ summary: 'Compara todas las guías de un consolidado/devolución' })
  compareConsolidated(@Param('consolidatedId') consolidatedId: string) {
    return this.compare.compareByConsolidated(consolidatedId);
  }
}
```

> Note: the constructor references `PersistentSyncSink` (built in Task 4). To keep Task 3 self-contained and compilable now, create a minimal stub file `src/tracking-sync/sinks/persistent-sync.sink.ts` with an empty injectable class in this task (Step 3b), then flesh it out in Task 4. The `POST /apply` method is added in Task 5.

- [ ] **Step 3b: Create the PersistentSyncSink stub (fleshed out in Task 4)**

```ts
// src/tracking-sync/sinks/persistent-sync.sink.ts
import { Injectable } from '@nestjs/common';

/** Sink de escritura (status-only). Implementación real en Task 4. */
@Injectable()
export class PersistentSyncSink {}
```

- [ ] **Step 4: Wire the module**

Edit `src/tracking-sync/tracking-sync.module.ts`:
- Add `Shipment` to the `TypeOrmModule.forFeature([...])` array (join `ShipmentStatus`, `TrackingSyncRun`, `TrackingSyncObservation`).
- Import `AuditModule` (from `src/audit/audit.module`) so `AuditService` is injectable in Task 4.
- Add to `providers`: `TrackingCompareService`, `PersistentSyncSink`.
- Add `controllers: [TrackingSyncController]`.

```ts
// resulting header additions
import { Shipment } from 'src/entities/shipment.entity';
import { AuditModule } from 'src/audit/audit.module';
import { TrackingCompareService } from './tracking-compare.service';
import { PersistentSyncSink } from './sinks/persistent-sync.sink';
import { TrackingSyncController } from './tracking-sync.controller';
// imports: [ TypeOrmModule.forFeature([ShipmentStatus, Shipment, TrackingSyncRun, TrackingSyncObservation]), ShipmentsModule, AuditModule ]
// controllers: [TrackingSyncController]
// providers: [ ...existing, TrackingCompareService, PersistentSyncSink ]
```

- [ ] **Step 5: Run tests + compile**

Run: `npx jest tracking-sync/tracking-sync.controller.spec --runInBand`
Expected: PASS (3 tests).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tracking-sync/tracking-sync.controller.ts src/tracking-sync/tracking-sync.controller.spec.ts src/tracking-sync/sinks/persistent-sync.sink.ts src/tracking-sync/tracking-sync.module.ts
git commit -m "feat(tracking-sync): superadmin compare endpoints + module wiring"
```

---

## Task 4: Backend — PersistentSyncSink (write, idempotent, audited)

**Repo:** `pmy-api`

**Files:**
- Modify: `src/tracking-sync/sinks/persistent-sync.sink.ts`
- Test: `src/tracking-sync/sinks/persistent-sync.sink.spec.ts`

**Interfaces:**
- Consumes: `DataSource` (TypeORM), `AuditService.log(dto)`, `ShipmentStatus`/`Shipment` entities, `SyncContext`, `buildShadowKey`, `ApplyOutcome`.
- Produces: `PersistentSyncSink.applyPlan(ctx: SyncContext, actor: { userId?: string; userName?: string; role?: string }): Promise<ApplyOutcome>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/sinks/persistent-sync.sink.spec.ts
import { PersistentSyncSink } from './persistent-sync.sink';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { buildShadowKey } from '../event-key.util';
import { SyncContext } from '../tracking-sync.types';

function fakeManager(existingRows: any[]) {
  const saved: any[] = [];
  return {
    saved,
    find: jest.fn().mockResolvedValue(existingRows),
    create: jest.fn().mockImplementation((_e: any, x: any) => x),
    save: jest.fn().mockImplementation(async (_e: any, x: any) => { saved.push(x); return x; }),
  };
}

function fakeDataSource(manager: any) {
  return {
    transaction: jest.fn().mockImplementation(async (cb: any) => cb(manager)),
  } as any;
}

function ctxWith(newEvents: any[], proposed: ShipmentStatusType, current: ShipmentStatusType): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN1', status: current } as any,
    normalized: { trackingNumber: 'TN1', events: [], latest: null, commitDateTime: null, validation: { ok: true, issues: [] } },
    reconcile: { newEvents, proposedStatus: proposed, currentStatus: current, transition: null },
    proposedStatus: proposed,
    vetoedEventKeys: new Set<string>(),
    deferredEffects: [], notes: [],
  };
}

describe('PersistentSyncSink.applyPlan', () => {
  const ev = (ms: number, status: ShipmentStatusType, ex: string | null) => ({
    occurredAt: new Date(ms), status, exceptionCode: ex, derivedCode: null, eventType: null, description: 'e', location: null,
    eventKey: 'k' + ms, shadowKey: buildShadowKey(ms, ex, status),
  });

  it('inserts missing events, updates status, logs audit', async () => {
    const manager = fakeManager([]); // no existing history
    const audit = { log: jest.fn() } as any;
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit);

    const ctx = ctxWith([ev(1000, ShipmentStatusType.EN_RUTA, null), ev(2000, ShipmentStatusType.ENTREGADO, null)], ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA);
    const out = await sink.applyPlan(ctx, { userId: 'u1', role: 'superadmin' });

    expect(out.applied).toBe(true);
    expect(out.insertedEvents).toBe(2);
    expect(out.toStatus).toBe(ShipmentStatusType.ENTREGADO);
    // one Shipment save (status) + 2 ShipmentStatus saves
    expect(manager.save).toHaveBeenCalledTimes(3);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: events already present (by shadowKey) are not re-inserted', async () => {
    const existing = [{ timestamp: new Date(1000), exceptionCode: null, status: ShipmentStatusType.EN_RUTA }];
    const manager = fakeManager(existing);
    const audit = { log: jest.fn() } as any;
    const sink = new PersistentSyncSink(fakeDataSource(manager), audit);

    const ctx = ctxWith([ev(1000, ShipmentStatusType.EN_RUTA, null)], ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA);
    const out = await sink.applyPlan(ctx, { role: 'superadmin' });

    expect(out.insertedEvents).toBe(0);
    expect(out.applied).toBe(false); // nothing changed (same status, no new events)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/sinks/persistent-sync.sink.spec --runInBand`
Expected: FAIL — `applyPlan` is not a function.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/sinks/persistent-sync.sink.ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { AuditService } from 'src/audit/audit.service';
import { AuditModule as AuditModuleEnum, AuditAction, AuditResult, AuditSeverity } from 'src/common/enums/audit.enum';
import { buildShadowKey } from '../event-key.util';
import { SyncContext } from '../tracking-sync.types';
import { ApplyOutcome } from '../compare.types';

export interface ApplyActor {
  userId?: string;
  userName?: string;
  role?: string;
}

/**
 * Sink de ESCRITURA (status-only). Inserta los eventos faltantes en shipment_status y
 * actualiza shipment.status en una transacción. Idempotente por shadowKey. NO genera
 * ingresos. Registra en auditoría. Disparado manualmente por superadmin.
 */
@Injectable()
export class PersistentSyncSink {
  private readonly logger = new Logger(PersistentSyncSink.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async applyPlan(ctx: SyncContext, actor: ApplyActor): Promise<ApplyOutcome> {
    const shipment = ctx.shipment;
    const fromStatus = shipment.status;
    const toStatus = ctx.proposedStatus;

    try {
      let inserted = 0;
      let statusChanged = false;

      await this.dataSource.transaction(async (m) => {
        // Recompute known shadowKeys inside the TX for a safe idempotent write.
        const rows = await m.find(ShipmentStatus, {
          where: { shipment: { id: shipment.id } },
          select: ['timestamp', 'exceptionCode', 'status'],
        });
        const known = new Set(
          rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)),
        );

        const toInsert = ctx.reconcile.newEvents.filter(
          (e) => !ctx.vetoedEventKeys.has(e.eventKey) && !known.has(e.shadowKey),
        );

        for (const e of toInsert) {
          const row = m.create(ShipmentStatus, {
            status: e.status,
            exceptionCode: e.exceptionCode ?? '',
            timestamp: e.occurredAt,
            notes: e.description ?? 'FedEx (panel)',
            shipment,
          });
          await m.save(ShipmentStatus, row);
          inserted++;
        }

        if (toStatus && toStatus !== fromStatus) {
          shipment.status = toStatus;
          await m.save(Shipment, shipment);
          statusChanged = true;
        }
      });

      const applied = inserted > 0 || statusChanged;
      if (applied) {
        this.auditService.log({
          userId: actor.userId,
          userName: actor.userName,
          role: actor.role,
          module: AuditModuleEnum.ENVIOS,
          action: AuditAction.STATUS_CHANGE,
          result: AuditResult.SUCCESS,
          severity: AuditSeverity.INFO,
          entityName: 'shipment',
          entityId: shipment.id,
          description: `Corrección manual FedEx (panel): ${fromStatus} → ${toStatus ?? fromStatus}, ${inserted} eventos`,
          beforeState: { status: fromStatus },
          afterState: { status: toStatus ?? fromStatus },
          changes: { status: { from: fromStatus, to: toStatus ?? fromStatus } },
          metadata: { trackingNumber: shipment.trackingNumber, insertedEvents: inserted },
        });
      }

      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        applied,
        fromStatus,
        toStatus: toStatus ?? fromStatus,
        insertedEvents: inserted,
      };
    } catch (err: any) {
      this.logger.error(`applyPlan ${shipment.trackingNumber}: ${err?.message}`);
      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        applied: false,
        fromStatus,
        toStatus: null,
        insertedEvents: 0,
        error: err?.message ?? 'Error aplicando',
      };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/sinks/persistent-sync.sink.spec --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/sinks/persistent-sync.sink.ts src/tracking-sync/sinks/persistent-sync.sink.spec.ts
git commit -m "feat(tracking-sync): PersistentSyncSink (status-only, idempotent, audited write)"
```

---

## Task 5: Backend — apply endpoint + `applyMany`

**Repo:** `pmy-api`

**Files:**
- Modify: `src/tracking-sync/tracking-compare.service.ts` (add `applyMany`)
- Modify: `src/tracking-sync/tracking-sync.controller.ts` (add `POST /apply`)
- Test: `src/tracking-sync/tracking-compare.service.spec.ts` (add apply case), `src/tracking-sync/tracking-sync.controller.spec.ts` (add apply case)

**Interfaces:**
- Produces: `TrackingCompareService.applyMany(shipmentIds: string[], actor): Promise<ApplyOutcome[]>`; `TrackingSyncController.apply(body, req)`.

- [ ] **Step 1: Write the failing service test (append)**

```ts
// append to src/tracking-sync/tracking-compare.service.spec.ts
describe('TrackingCompareService.applyMany', () => {
  it('builds a context per shipment and delegates to the persistent sink', async () => {
    const shipment = { id: 's1', trackingNumber: 'TN1', status: 'en_ruta' };
    const shipmentRepo = { findOne: jest.fn().mockResolvedValue(shipment), find: jest.fn() } as any;
    const statusRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const source = { fetch: jest.fn().mockResolvedValue([{ trackingNumber: 'TN1', trackResults: [{}] }]) } as any;
    const normalizer = { normalize: jest.fn().mockReturnValue({ events: [], latest: { status: 'entregado' }, validation: { ok: true, issues: [] } }) } as any;
    const reconciler = { reconcile: jest.fn().mockReturnValue({ newEvents: [], proposedStatus: 'entregado', currentStatus: 'en_ruta', transition: null }) } as any;
    const pipeline = { run: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = { applyPlan: jest.fn().mockResolvedValue({ shipmentId: 's1', trackingNumber: 'TN1', applied: true, fromStatus: 'en_ruta', toStatus: 'entregado', insertedEvents: 0 }) } as any;

    const { TrackingCompareService } = require('./tracking-compare.service');
    const svc = new TrackingCompareService(shipmentRepo, statusRepo, source, normalizer, reconciler, pipeline, sink);
    const out = await svc.applyMany(['s1'], { role: 'superadmin' });
    expect(out).toHaveLength(1);
    expect(sink.applyPlan).toHaveBeenCalledTimes(1);
    expect(out[0].applied).toBe(true);
  });
});
```

> This test injects a 7th constructor arg (`sink`). Update the `TrackingCompareService` constructor to accept `private readonly persistentSink: PersistentSyncSink` as the last param, and update earlier tests' construction accordingly (they pass 6 args; add a stub `{} as any` 7th where needed, or the new arg is optional-safe because those tests don't call `applyMany`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tracking-sync/tracking-compare.service.spec --runInBand`
Expected: FAIL — `applyMany` is not a function.

- [ ] **Step 3: Implement `applyMany` (and add sink to constructor)**

```ts
// add PersistentSyncSink import + constructor param, and this method:
import { createLimit } from './concurrency.util';
import { PersistentSyncSink } from './sinks/persistent-sync.sink';
import { ApplyActor } from './sinks/persistent-sync.sink';
import { ApplyOutcome } from './compare.types';

// constructor: add `private readonly persistentSink: PersistentSyncSink,` as last param

  async applyMany(shipmentIds: string[], actor: ApplyActor): Promise<ApplyOutcome[]> {
    const ids = [...new Set((shipmentIds || []).filter(Boolean))];
    const limit = createLimit(6); // concurrencia controlada hacia FedEx (sin tope de selección)
    return Promise.all(
      ids.map((id) =>
        limit(async () => {
          const shipment = await this.shipmentRepo.findOne({ where: { id }, relations: ['subsidiary'] });
          if (!shipment) {
            return { shipmentId: id, trackingNumber: '', applied: false, fromStatus: null as any, toStatus: null, insertedEvents: 0, skippedReason: 'Shipment no encontrado' };
          }
          const [raw] = await this.source.fetch([
            { trackingNumber: shipment.trackingNumber, fedexUniqueId: shipment.fedexUniqueId, carrierCode: shipment.carrierCode },
          ]);
          if (!raw || raw.trackResults.length === 0) {
            return { shipmentId: id, trackingNumber: shipment.trackingNumber, applied: false, fromStatus: shipment.status, toStatus: null, insertedEvents: 0, skippedReason: 'Sin datos FedEx' };
          }
          const normalized = this.normalizer.normalize(raw);
          const rows = await this.statusRepo.find({ where: { shipment: { id: shipment.id } }, select: ['timestamp', 'exceptionCode', 'status'] });
          const knownKeys = new Set(rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)));
          const reconcile = this.reconciler.reconcile(normalized, knownKeys, shipment.status, (e) => e.shadowKey);
          const ctx: SyncContext = { shipment, normalized, reconcile, proposedStatus: reconcile.proposedStatus, vetoedEventKeys: new Set<string>(), deferredEffects: [], notes: [] };
          await this.pipeline.run(ctx);
          return this.persistentSink.applyPlan(ctx, actor);
        }),
      ),
    );
  }
```

- [ ] **Step 4: Write the failing controller test (append)**

```ts
// append to src/tracking-sync/tracking-sync.controller.spec.ts
it('apply delegates to compare.applyMany with actor from req.user', async () => {
  const compareSvc: any = { applyMany: jest.fn().mockResolvedValue([]) };
  const ctrl = new (require('./tracking-sync.controller').TrackingSyncController)(compareSvc, {} as any);
  const req = { user: { id: 'u1', name: 'Super', role: 'superadmin' } };
  await ctrl.apply({ shipmentIds: ['s1', 's2'] }, req);
  expect(compareSvc.applyMany).toHaveBeenCalledWith(['s1', 's2'], { userId: 'u1', userName: 'Super', role: 'superadmin' });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx jest tracking-sync/tracking-sync.controller.spec --runInBand`
Expected: FAIL — `apply` is not a function.

- [ ] **Step 6: Add the endpoint**

```ts
// add to TrackingSyncController
import { Req } from '@nestjs/common';

  @Post('apply')
  @ApiOperation({ summary: 'Aplica el estatus de FedEx (status-only) a las guías indicadas' })
  apply(@Body() body: { shipmentIds: string[] }, @Req() req: any) {
    const actor = { userId: req.user?.id, userName: req.user?.name, role: req.user?.role };
    return this.compare.applyMany(body?.shipmentIds ?? [], actor);
  }
```

- [ ] **Step 7: Run tests + compile**

Run: `npx jest tracking-sync --runInBand`
Expected: PASS (whole module suite).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Boot check + commit**

Run: `timeout 90 npm run start:dev > /tmp/panel-boot.log 2>&1; grep -iE "TrackingSyncModule dependencies initialized|successfully started|can't resolve" /tmp/panel-boot.log`
Expected: module initialized + app started, no DI errors.

```bash
git add src/tracking-sync/tracking-compare.service.ts src/tracking-sync/tracking-sync.controller.ts src/tracking-sync/tracking-compare.service.spec.ts src/tracking-sync/tracking-sync.controller.spec.ts
git commit -m "feat(tracking-sync): apply endpoint + applyMany (superadmin manual correction)"
```

---

## Task 6: Frontend — API service + pure summary helper

**Repo:** `app-pmy`

**Files:**
- Create: `lib/services/tracking-sync.ts`
- Create: `lib/tracking/compare-summary.ts`
- Test: `lib/tracking/compare-summary.test.ts`

**Interfaces:**
- Produces: typed `compareByTracking/compareByRoute/compareByConsolidated/applyCorrections`; `summarizeCompare(results): { total: number; stale: number; diverging: number }`, `rowFlag(r): 'stale' | 'diverges' | 'ok'`.

- [ ] **Step 1: Write the API service**

```ts
// lib/services/tracking-sync.ts
import { axiosConfig } from "../axios-config";

export interface NormalizedEventDto {
  occurredAt: string;
  status: string;
  derivedCode: string | null;
  exceptionCode: string | null;
  description: string | null;
  location: string | null;
}

export interface CompareResult {
  shipmentId: string;
  trackingNumber: string;
  ourStatus: string;
  ourLastEventAt: string | null;
  fedexStatus: string | null;
  fedexLastEventAt: string | null;
  diverges: boolean;
  isStale: boolean;
  missingEvents: NormalizedEventDto[];
  fedexEvents: NormalizedEventDto[];
  issues: string[];
  error?: string;
}

export interface ApplyOutcome {
  shipmentId: string;
  trackingNumber: string;
  applied: boolean;
  fromStatus: string;
  toStatus: string | null;
  insertedEvents: number;
  skippedReason?: string;
  error?: string;
}

export const compareByTracking = async (trackingNumber: string) => {
  const res = await axiosConfig.get<CompareResult>(`tracking-sync/compare/tracking/${encodeURIComponent(trackingNumber)}`);
  return res.data;
};

export const compareByRoute = async (routeId: string) => {
  const res = await axiosConfig.get<CompareResult[]>(`tracking-sync/compare/route/${routeId}`);
  return res.data;
};

export const compareByConsolidated = async (consolidatedId: string) => {
  const res = await axiosConfig.get<CompareResult[]>(`tracking-sync/compare/consolidated/${consolidatedId}`);
  return res.data;
};

export const applyCorrections = async (shipmentIds: string[]) => {
  const res = await axiosConfig.post<ApplyOutcome[]>(`tracking-sync/apply`, { shipmentIds });
  return res.data;
};
```

- [ ] **Step 2: Write the failing helper test**

```ts
// lib/tracking/compare-summary.test.ts
import { describe, it, expect } from "vitest";
import { summarizeCompare, rowFlag } from "./compare-summary";
import type { CompareResult } from "../services/tracking-sync";

const base: CompareResult = {
  shipmentId: "s", trackingNumber: "t", ourStatus: "en_ruta", ourLastEventAt: null,
  fedexStatus: "en_ruta", fedexLastEventAt: null, diverges: false, isStale: false,
  missingEvents: [], fedexEvents: [], issues: [],
};

describe("compare-summary", () => {
  it("counts total, stale and diverging", () => {
    const rows: CompareResult[] = [
      { ...base },
      { ...base, isStale: true },
      { ...base, diverges: true },
      { ...base, isStale: true, diverges: true },
    ];
    expect(summarizeCompare(rows)).toEqual({ total: 4, stale: 2, diverging: 2 });
  });

  it("rowFlag prioritizes diverges over stale over ok", () => {
    expect(rowFlag({ ...base, diverges: true, isStale: true })).toBe("diverges");
    expect(rowFlag({ ...base, isStale: true })).toBe("stale");
    expect(rowFlag({ ...base })).toBe("ok");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run lib/tracking/compare-summary`
Expected: FAIL — cannot find module `./compare-summary`.

- [ ] **Step 4: Write the helper**

```ts
// lib/tracking/compare-summary.ts
import type { CompareResult } from "../services/tracking-sync";

export function summarizeCompare(rows: CompareResult[]) {
  return {
    total: rows.length,
    stale: rows.filter((r) => r.isStale).length,
    diverging: rows.filter((r) => r.diverges).length,
  };
}

export function rowFlag(r: CompareResult): "diverges" | "stale" | "ok" {
  if (r.diverges) return "diverges";
  if (r.isStale) return "stale";
  return "ok";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/tracking/compare-summary`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit** (in `app-pmy`)

```bash
git add lib/services/tracking-sync.ts lib/tracking/compare-summary.ts lib/tracking/compare-summary.test.ts
git commit -m "feat(tracking-sync): frontend API client + compare summary helper"
```

---

## Task 7: Frontend — comparison table component (read-only)

**Repo:** `app-pmy`

**Files:**
- Create: `components/tracking-sync/compare-table.tsx`

**Interfaces:**
- Consumes: `CompareResult`, `rowFlag`.
- Produces: `<CompareTable rows={CompareResult[]} selectable? onSelectionChange? />` (Phase A: read-only, no correct button yet).

- [ ] **Step 1: Build the component**

Follow the repo's existing table styling (Tailwind + shadcn primitives used elsewhere in `components/`). The component renders a summary line and a table; rows flagged `diverges`/`stale` get a colored left border/background; each row expands to show `fedexEvents` vs our last event, marking `missingEvents`.

```tsx
// components/tracking-sync/compare-table.tsx
"use client";
import { useState } from "react";
import type { CompareResult } from "@/lib/services/tracking-sync";
import { rowFlag, summarizeCompare } from "@/lib/tracking/compare-summary";

const FLAG_STYLES: Record<string, string> = {
  diverges: "border-l-4 border-red-500 bg-red-50",
  stale: "border-l-4 border-amber-500 bg-amber-50",
  ok: "border-l-4 border-transparent",
};

export function CompareTable({ rows }: { rows: CompareResult[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const summary = summarizeCompare(rows);

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {summary.total} guías · <span className="text-red-600 font-medium">{summary.diverging} divergen</span> ·{" "}
        <span className="text-amber-600 font-medium">{summary.stale} desactualizadas vs FedEx</span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-2">Guía</th>
              <th className="p-2">Nuestro estatus</th>
              <th className="p-2">Últ. evento nuestro</th>
              <th className="p-2">Estatus FedEx</th>
              <th className="p-2">Últ. evento FedEx</th>
              <th className="p-2">Faltantes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr
                  key={r.shipmentId || r.trackingNumber}
                  className={`cursor-pointer ${FLAG_STYLES[rowFlag(r)]}`}
                  onClick={() => setOpen((o) => ({ ...o, [r.trackingNumber]: !o[r.trackingNumber] }))}
                >
                  <td className="p-2 font-mono">{r.trackingNumber}</td>
                  <td className="p-2">{r.ourStatus}</td>
                  <td className="p-2">{r.ourLastEventAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="p-2">{r.error ? <span className="text-slate-400">{r.error}</span> : r.fedexStatus ?? "—"}</td>
                  <td className="p-2">{r.fedexLastEventAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="p-2">{r.missingEvents.length}</td>
                </tr>
                {open[r.trackingNumber] && (
                  <tr>
                    <td colSpan={6} className="p-3 bg-slate-50">
                      <div className="text-xs font-medium mb-1">Timeline FedEx</div>
                      <ul className="space-y-1">
                        {r.fedexEvents.map((e, i) => (
                          <li key={i} className="text-xs">
                            <span className="font-mono">{e.occurredAt.slice(0, 16).replace("T", " ")}</span> · {e.status}
                            {e.exceptionCode ? ` (${e.exceptionCode})` : ""} · {e.description ?? ""} {e.location ? `— ${e.location}` : ""}
                          </li>
                        ))}
                        {r.fedexEvents.length === 0 && <li className="text-xs text-slate-400">Sin eventos</li>}
                      </ul>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Do NOT run `next dev`.)

- [ ] **Step 3: Commit** (in `app-pmy`)

```bash
git add components/tracking-sync/compare-table.tsx
git commit -m "feat(tracking-sync): read-only comparison table component"
```

---

## Task 8: Frontend — page (3 modes) + superadmin menu entry

**Repo:** `app-pmy`

**Files:**
- Create: `app/dev/tracking-sync/page.tsx`
- Modify: `components/app-sidebar.tsx`

**Interfaces:**
- Consumes: service functions from Task 6, `CompareTable` from Task 7.

- [ ] **Step 1: Build the page (Phase A: read-only)**

```tsx
// app/dev/tracking-sync/page.tsx
"use client";
import { useState } from "react";
import { CompareTable } from "@/components/tracking-sync/compare-table";
import {
  compareByTracking, compareByRoute, compareByConsolidated, type CompareResult,
} from "@/lib/services/tracking-sync";

type Mode = "tracking" | "route" | "consolidated";

export default function TrackingSyncPage() {
  const [mode, setMode] = useState<Mode>("tracking");
  const [value, setValue] = useState("");
  const [rows, setRows] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!value.trim()) return;
    setLoading(true); setError(null);
    try {
      if (mode === "tracking") setRows([await compareByTracking(value.trim())]);
      else if (mode === "route") setRows(await compareByRoute(value.trim()));
      else setRows(await compareByConsolidated(value.trim()));
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? "Error consultando");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const placeholder =
    mode === "tracking" ? "Número de guía" : mode === "route" ? "ID de salida a ruta" : "ID de consolidado/devolución";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sincronización FedEx (experimental)</h1>
        <p className="text-sm text-muted-foreground">Compara nuestro estatus contra FedEx en vivo. Solo lectura.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["tracking", "route", "consolidated"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setRows([]); }}
            className={`px-3 py-1.5 rounded-lg text-sm border ${mode === m ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`}
          >
            {m === "tracking" ? "Por guía" : m === "route" ? "Por salida a ruta" : "Por devolución/consolidado"}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="border rounded-lg px-3 py-1.5 text-sm w-80"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button onClick={run} disabled={loading} className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50">
          {loading ? "Consultando…" : "Consultar FedEx ahora"}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {rows.length > 0 && <CompareTable rows={rows} />}
    </div>
  );
}
```

- [ ] **Step 2: Add the superadmin-gated menu entry**

In `components/app-sidebar.tsx`, mirror the `monitoreoRutasItem` pattern (production-visible, role-gated — NOT the `IS_DEV` gate). Add near it:

```tsx
// import an icon already used in the repo, e.g. RefreshCw from lucide-react
const trackingSyncItem = ["superadmin", "superamin"].includes((user?.role ?? "").toLowerCase())
  ? [{ title: "Sincronización FedEx", url: "/dev/tracking-sync", icon: RefreshCw }]
  : [];
```

Then include it in `secondaryItems`:

```tsx
const secondaryItems = [
  ...(sidebarMenu.secondary ?? []),
  ...(IS_DEV ? DEV_ITEMS : []),
  ...monitoreoRutasItem,
  ...trackingSyncItem,
];
```

> Verify the exact role-reading approach against the repo's helpers (`hasPermission`, `withAuth`, `SUPER_ROLES`). If a `hasPermission(user, ...)` helper is the established gate, prefer a role check consistent with the other superadmin-only entries (`["superadmin","superamin"]`).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit** (in `app-pmy`)

```bash
git add app/dev/tracking-sync/page.tsx components/app-sidebar.tsx
git commit -m "feat(tracking-sync): experimental panel page + superadmin menu entry"
```

---

## Task 9: Frontend — "Corregir ahora" (Phase B)

**Repo:** `app-pmy`

**Files:**
- Modify: `components/tracking-sync/compare-table.tsx` (selection + correct button + confirm modal)
- Modify: `app/dev/tracking-sync/page.tsx` (wire apply + refresh)
- Create: `lib/tracking/apply-selection.ts`
- Test: `lib/tracking/apply-selection.test.ts`

**Interfaces:**
- Produces: `correctableShipmentIds(rows, selectedTrackingNumbers): string[]` (pure helper — only rows that diverge/stale and have a shipmentId + fedexStatus).

- [ ] **Step 1: Write the failing helper test**

```ts
// lib/tracking/apply-selection.test.ts
import { describe, it, expect } from "vitest";
import { correctableShipmentIds } from "./apply-selection";
import type { CompareResult } from "../services/tracking-sync";

const r = (over: Partial<CompareResult>): CompareResult => ({
  shipmentId: "s", trackingNumber: "t", ourStatus: "en_ruta", ourLastEventAt: null,
  fedexStatus: "entregado", fedexLastEventAt: null, diverges: true, isStale: true,
  missingEvents: [], fedexEvents: [], issues: [], ...over,
});

describe("correctableShipmentIds", () => {
  it("keeps only selected rows that are correctable (have shipmentId + fedexStatus + a change)", () => {
    const rows = [
      r({ shipmentId: "s1", trackingNumber: "T1" }),
      r({ shipmentId: "", trackingNumber: "T2" }),                 // no shipmentId
      r({ shipmentId: "s3", trackingNumber: "T3", fedexStatus: null }), // no fedex data
      r({ shipmentId: "s4", trackingNumber: "T4", diverges: false, isStale: false }), // nothing to change
    ];
    expect(correctableShipmentIds(rows, ["T1", "T2", "T3", "T4"])).toEqual(["s1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tracking/apply-selection`
Expected: FAIL — cannot find module `./apply-selection`.

- [ ] **Step 3: Write the helper**

```ts
// lib/tracking/apply-selection.ts
import type { CompareResult } from "../services/tracking-sync";

/** IDs de shipment corregibles entre los seleccionados: con shipmentId, con dato FedEx y con algo que cambiar. */
export function correctableShipmentIds(rows: CompareResult[], selectedTrackingNumbers: string[]): string[] {
  const selected = new Set(selectedTrackingNumbers);
  return rows
    .filter((r) => selected.has(r.trackingNumber))
    .filter((r) => r.shipmentId && r.fedexStatus && (r.diverges || r.isStale))
    .map((r) => r.shipmentId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tracking/apply-selection`
Expected: PASS (1 test).

- [ ] **Step 5: Add selection + correct button + confirm modal to `CompareTable`**

Add row checkboxes, a bulk "Corregir seleccionadas" button, and a confirmation modal listing exactly what will change (tracking, from → to, N events). On confirm, call the `onApply(shipmentIds)` prop passed from the page. Use `correctableShipmentIds` to compute the payload. Keep the modal copy explicit: "Esto escribirá el estatus en producción (solo estatus, no genera cobros)."

```tsx
// add to CompareTable props: { rows, onApply?: (shipmentIds: string[]) => Promise<void> }
// add: const [selected, setSelected] = useState<Set<string>>(new Set());
//      const [confirm, setConfirm] = useState(false);
// render a checkbox column when onApply is provided, a "Corregir seleccionadas" button,
// and a modal that maps selected → correctableShipmentIds(rows, [...selected]) before calling onApply.
```

- [ ] **Step 6: Wire apply in the page**

```tsx
// app/dev/tracking-sync/page.tsx — add:
import { applyCorrections } from "@/lib/services/tracking-sync";

const onApply = async (shipmentIds: string[]) => {
  if (shipmentIds.length === 0) return;
  await applyCorrections(shipmentIds);
  await run(); // refresca la comparación para reflejar el nuevo estado
};
// pass onApply to <CompareTable rows={rows} onApply={onApply} />
```

- [ ] **Step 7: Type-check + run frontend tests**

Run: `npx vitest run lib/tracking`
Expected: PASS (all helper tests).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit** (in `app-pmy`)

```bash
git add components/tracking-sync/compare-table.tsx app/dev/tracking-sync/page.tsx lib/tracking/apply-selection.ts lib/tracking/apply-selection.test.ts
git commit -m "feat(tracking-sync): corregir ahora (selection + confirm + apply)"
```

---

## Self-Review Notes (author checklist — already applied)

- **Spec coverage:** compare live (§3.1 `TrackingCompareService`) → T1–T2; 3 entry points (§2) → T1 (tracking), T2 (route/consolidated); endpoints + guard (§3.1) → T3, T5; `CompareResult`/`ApplyOutcome` DTOs (§3.2/§3.3) → T1; write path status-only + idempotent + audit (§3.1, §4) → T4; apply endpoint + no cap (§2, §4.6) → T5; frontend page 3 modes + table + expand (§5) → T6–T8; superadmin menu (§5) → T8; corregir + modal + bulk (§5) → T9; testing without `next dev` (§7) → Vitest + tsc throughout; phases A/B (§6) → T1–3/6–8 vs T4–5/9.
- **Out of scope honored:** no income generation (T4 comment + audit only), no cron auto-write, no shadow-history UI, no F2.
- **Type consistency:** `CompareResult`/`ApplyOutcome`/`NormalizedEventDto` identical across backend (T1) and frontend (T6); `applyPlan(ctx, actor)` (T4) called by `applyMany` (T5); `compareShipment` reused by T1/T2/T5; `correctableShipmentIds`/`summarizeCompare`/`rowFlag` names stable T6–T9.
- **Known deviation from spec:** apply updates `shipment.status` + inserts history only; it does NOT update `fedexUniqueId`/`carrierCode`/`receivedByName` (those aren't carried on `NormalizedEvent`). Still status-only and safe; noted here so the implementer doesn't chase the spec's optional mention.
