# FedEx Tracking Sync Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new, layered FedEx tracking status **sync engine** that runs in **shadow mode** (computes what it *would* do, writes only to its own tables, never touches `shipment`/`shipment_status`).

**Architecture:** Layered pipeline — `TrackingSource` (carrier fetch) → `TrackingNormalizer` (raw → full normalized event list) → `EventReconciler` (pure diff) → `SyncRulesPipeline` (Chain of Responsibility over a mutable `SyncContext`) → `SyncSink` (shadow recorder). Orchestrator drives batching, concurrency, circuit breaker, dead-letter and metrics. New isolated module `src/tracking-sync/`; entities live in `src/entities/` (auto-globbed).

**Tech Stack:** NestJS, TypeORM (MySQL), TypeScript, Jest (ts-jest), `p-limit`, `@nestjs/schedule` (all already in the repo).

## Global Constraints

- **Shadow only:** NO writes to `shipment` or `shipment_status`; NO `ALTER TABLE` on `shipment_status`. Engine writes only to `tracking_sync_run` and `tracking_sync_observation`.
- **Schema via migration only:** `DB_SYNC=false` in ALL environments (incl. dev). Every schema change is a TypeORM migration in `src/database/migrations/`, idempotent (guard with `hasTable`/`findColumnByName`).
- **Entities** are auto-globbed from `src/entities/*.entity.{js,ts}`; **migrations** from `src/database/migrations/*.{js,ts}` (see `src/config/config.ts`).
- **Migration naming:** timestamped class, next free prefix is `1786000000012` (last used: `...011`).
- **Reuse infra only:** `FedexService` (`src/shipments/fedex.service.ts`) and the canonical mapping `resolveCanonicalStatus` (`src/fedex-status/fedex-status.mapping.ts`). Do NOT reuse `processMasterFedexUpdate` or any logic in `src/shipments/shipments.service.ts`.
- **Tests:** Jest, `rootDir: src`, `testRegex: .*\.spec\.ts$`. Specs sit next to code. Import via `src/...` alias. Run with `npx jest <path-fragment> --runInBand`.
- **Status enum:** `ShipmentStatusType` and `TERMINAL_SHIPMENT_STATUSES` from `src/common/enums/shipment-status-type.enum.ts`.

---

## File Structure

**Entities (`src/entities/`, auto-globbed):**
- `tracking-sync-run.entity.ts` — one row per orchestrator run (metrics).
- `tracking-sync-observation.entity.ts` — one row per shipment per run (what the engine would do).

**Migration:**
- `src/database/migrations/1786000000012-CreateTrackingSyncTables.ts`

**Module (`src/tracking-sync/`):**
- `tracking-sync.types.ts` — all shared interfaces/tokens.
- `event-key.util.ts` — `buildEventKey` (full) + `buildShadowKey` (reconstructable from `shipment_status`).
- `tracking-normalizer.ts` — raw → `NormalizedTracking`.
- `event-reconciler.ts` — pure diff.
- `rules/terminal-lock.rule.ts` — block terminal→operative regressions.
- `rules/external-delivery.rule.ts` — OD per subsidiary.
- `rules/income.rule.ts` — declared, INACTIVE (no-op).
- `rules/notification.rule.ts` — declared, INACTIVE (no-op).
- `sync-rules.pipeline.ts` — orders + runs rules; `SYNC_RULES` provider.
- `sources/fedex-tracking.source.ts` — `TrackingSource` impl (generation selector).
- `sinks/shadow-sync.sink.ts` — `SyncSink` shadow recorder.
- `existing-event-loader.ts` — read-only loader of known `shadowKey`s from `shipment_status`.
- `tracking-sync.orchestrator.ts` — batching, breaker, dead-letter, metrics.
- `tracking-sync.cron.ts` — hourly at `:15`, own re-entry guard.
- `tracking-sync.module.ts` — wiring.
- `*.spec.ts` next to each unit.

---

## Task 1: Shared types + key utils

**Files:**
- Create: `src/tracking-sync/tracking-sync.types.ts`
- Create: `src/tracking-sync/event-key.util.ts`
- Test: `src/tracking-sync/event-key.util.spec.ts`

**Interfaces:**
- Produces: `TrackingRef`, `RawTrackingResult`, `NormalizedEvent`, `StatusValidation`, `NormalizedTracking`, `ReconcileResult`, `DeferredEffect`, `SyncContext`, `SyncRule`, `SinkOutcome`, `SyncSink`, `TrackingSource`, `SYNC_RULES` (DI token). `buildEventKey(input)`, `buildShadowKey(occurredAtMs, exceptionCode, status)`.

- [ ] **Step 1: Write the types file**

```ts
// src/tracking-sync/tracking-sync.types.ts
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Shipment } from 'src/entities/shipment.entity';

/** Referencia mínima para consultar un carrier. */
export interface TrackingRef {
  trackingNumber: string;
  fedexUniqueId?: string;
  carrierCode?: string;
}

/** Resultado crudo del carrier. El Source ya eligió la generación → `trackResults: [winner]`. */
export interface RawTrackingResult {
  trackingNumber: string;
  trackResults: any[];
}

/** Evento normalizado, carrier-agnóstico. */
export interface NormalizedEvent {
  occurredAt: Date;
  derivedCode: string | null;
  statusCode: string | null;
  exceptionCode: string | null;
  eventType: string | null;
  description: string | null;
  location: string | null;
  status: ShipmentStatusType;
  /** Clave determinista final (para el cutover: dedup en shipment_status). */
  eventKey: string;
  /** Clave reconstruible desde columnas existentes de shipment_status (para shadow). */
  shadowKey: string;
}

export interface StatusValidation {
  ok: boolean;
  issues: string[];
}

export interface NormalizedTracking {
  trackingNumber: string;
  /** Ordenados ascendente por `occurredAt`. */
  events: NormalizedEvent[];
  latest: NormalizedEvent | null;
  commitDateTime: Date | null;
  validation: StatusValidation;
}

export interface ReconcileResult {
  /** Eventos cuya clave no está en el set conocido (asc por fecha). */
  newEvents: NormalizedEvent[];
  proposedStatus: ShipmentStatusType | null;
  currentStatus: ShipmentStatusType;
  transition: { from: ShipmentStatusType; to: ShipmentStatusType } | null;
}

/** Side-effect encolado por una regla; NUNCA se ejecuta dentro de la regla. */
export interface DeferredEffect {
  type: string;
  payload: Record<string, any>;
}

/** Estado mutable que atraviesa el pipeline de reglas. */
export interface SyncContext {
  shipment: Shipment;
  normalized: NormalizedTracking;
  reconcile: ReconcileResult;
  proposedStatus: ShipmentStatusType | null;
  vetoedEventKeys: Set<string>;
  deferredEffects: DeferredEffect[];
  notes: string[];
}

export interface SyncRule {
  readonly name: string;
  readonly priority: number; // mayor = corre primero
  apply(ctx: SyncContext): void | Promise<void>;
}

export interface SinkOutcome {
  shipmentId: string;
  trackingNumber: string;
  proposedStatus: ShipmentStatusType | null;
  wouldInsertEvents: number;
  matchesLegacy: boolean;
}

export interface SyncSink {
  applyPlan(ctx: SyncContext, runId: string): Promise<SinkOutcome>;
}

export interface TrackingSource {
  fetch(refs: TrackingRef[]): Promise<RawTrackingResult[]>;
}

/** Token DI para inyectar el array de reglas. */
export const SYNC_RULES = Symbol('SYNC_RULES');
```

- [ ] **Step 2: Write the failing test**

```ts
// src/tracking-sync/event-key.util.spec.ts
import { buildEventKey, buildShadowKey } from './event-key.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('event-key utils', () => {
  const base = {
    trackingNumber: '123',
    occurredAt: new Date('2026-08-15T10:00:00Z'),
    derivedCode: 'IT',
    eventType: 'IT',
    exceptionCode: '',
    location: 'Hermosillo',
  };

  it('buildEventKey is deterministic (idempotent)', () => {
    expect(buildEventKey(base)).toBe(buildEventKey({ ...base }));
  });

  it('buildEventKey changes when a component changes', () => {
    expect(buildEventKey(base)).not.toBe(buildEventKey({ ...base, exceptionCode: '08' }));
  });

  it('buildEventKey is case-insensitive on codes/location', () => {
    expect(buildEventKey(base)).toBe(buildEventKey({ ...base, derivedCode: 'it', location: 'hermosillo' }));
  });

  it('buildShadowKey matches on (timestamp, exception, status)', () => {
    const ms = base.occurredAt.getTime();
    expect(buildShadowKey(ms, '08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE))
      .toBe(buildShadowKey(ms, '08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tracking-sync/event-key.util.spec --runInBand`
Expected: FAIL — cannot find module `./event-key.util`.

- [ ] **Step 4: Write the implementation**

```ts
// src/tracking-sync/event-key.util.ts
import { createHash } from 'crypto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/** Clave determinista final para dedup robusto en el cutover. */
export function buildEventKey(input: {
  trackingNumber: string;
  occurredAt: Date;
  derivedCode?: string | null;
  eventType?: string | null;
  exceptionCode?: string | null;
  location?: string | null;
}): string {
  const parts = [
    input.trackingNumber,
    String(input.occurredAt ? input.occurredAt.getTime() : 0),
    (input.derivedCode || input.eventType || '').toUpperCase(),
    (input.exceptionCode || '').toUpperCase(),
    (input.location || '').toUpperCase(),
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

/**
 * Clave "shadow": reconstruible tanto desde un evento normalizado como desde una fila
 * existente de `shipment_status` (que solo tiene timestamp, exceptionCode y status).
 * Permite detectar eventos nuevos en shadow sin migrar la tabla real.
 */
export function buildShadowKey(
  occurredAtMs: number,
  exceptionCode: string | null | undefined,
  status: ShipmentStatusType,
): string {
  return `${occurredAtMs}|${(exceptionCode || '').trim().toUpperCase()}|${status}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tracking-sync/event-key.util.spec --runInBand`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tracking-sync/tracking-sync.types.ts src/tracking-sync/event-key.util.ts src/tracking-sync/event-key.util.spec.ts
git commit -m "feat(tracking-sync): shared types + deterministic event/shadow keys"
```

---

## Task 2: Entities + migration

**Files:**
- Create: `src/entities/tracking-sync-run.entity.ts`
- Create: `src/entities/tracking-sync-observation.entity.ts`
- Create: `src/database/migrations/1786000000012-CreateTrackingSyncTables.ts`
- Test: `src/tracking-sync/entities.spec.ts`

**Interfaces:**
- Produces: `TrackingSyncRun`, `TrackingSyncObservation` entity classes.

- [ ] **Step 1: Write the run entity**

```ts
// src/entities/tracking-sync-run.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Una fila por corrida del orquestador de sincronización (métricas). */
@Entity('tracking_sync_run')
export class TrackingSyncRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'shadow' })
  mode: string;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  ok: number;

  @Column({ type: 'int', default: 0 })
  noData: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ default: false })
  aborted: boolean;

  @Column({ type: 'int', default: 0 })
  matchesLegacy: number;

  @Column({ type: 'int', default: 0 })
  divergesLegacy: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
```

- [ ] **Step 2: Write the observation entity**

```ts
// src/entities/tracking-sync-observation.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Una fila por guía por corrida: lo que el motor HARÍA (shadow), sin tocar shipment_status. */
@Entity('tracking_sync_observation')
@Unique('uq_run_shipment', ['runId', 'shipmentId'])
export class TrackingSyncObservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'char', length: 36 })
  runId: string;

  @Index()
  @Column({ type: 'char', length: 36 })
  shipmentId: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  trackingNumber: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  proposedStatus: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  legacyCurrentStatus: string | null;

  @Column({ type: 'int', default: 0 })
  wouldInsertEvents: number;

  /** JSON string con las eventKey que insertaría (trazabilidad). */
  @Column({ type: 'text', nullable: true })
  wouldInsertEventKeys: string | null;

  @Column({ default: false })
  matchesLegacy: boolean;

  /** JSON string con issues de validación. */
  @Column({ type: 'text', nullable: true })
  issues: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
```

- [ ] **Step 3: Write the migration**

```ts
// src/database/migrations/1786000000012-CreateTrackingSyncTables.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del motor de sincronización de tracking (shadow mode).
 * NO toca shipment_status ni shipment. Solo crea las tablas propias del motor.
 */
export class CreateTrackingSyncTables1786000000012 implements MigrationInterface {
  name = 'CreateTrackingSyncTables1786000000012';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('tracking_sync_run'))) {
      await q.query(`
        CREATE TABLE \`tracking_sync_run\` (
          \`id\` CHAR(36) NOT NULL,
          \`startedAt\` DATETIME NOT NULL,
          \`finishedAt\` DATETIME NULL,
          \`mode\` VARCHAR(16) NOT NULL DEFAULT 'shadow',
          \`total\` INT NOT NULL DEFAULT 0,
          \`ok\` INT NOT NULL DEFAULT 0,
          \`noData\` INT NOT NULL DEFAULT 0,
          \`failed\` INT NOT NULL DEFAULT 0,
          \`aborted\` TINYINT(1) NOT NULL DEFAULT 0,
          \`matchesLegacy\` INT NOT NULL DEFAULT 0,
          \`divergesLegacy\` INT NOT NULL DEFAULT 0,
          \`notes\` TEXT NULL,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await q.hasTable('tracking_sync_observation'))) {
      await q.query(`
        CREATE TABLE \`tracking_sync_observation\` (
          \`id\` CHAR(36) NOT NULL,
          \`runId\` CHAR(36) NOT NULL,
          \`shipmentId\` CHAR(36) NOT NULL,
          \`trackingNumber\` VARCHAR(255) NOT NULL,
          \`proposedStatus\` VARCHAR(64) NULL,
          \`legacyCurrentStatus\` VARCHAR(64) NULL,
          \`wouldInsertEvents\` INT NOT NULL DEFAULT 0,
          \`wouldInsertEventKeys\` TEXT NULL,
          \`matchesLegacy\` TINYINT(1) NOT NULL DEFAULT 0,
          \`issues\` TEXT NULL,
          \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_run_shipment\` (\`runId\`, \`shipmentId\`),
          KEY \`idx_obs_run\` (\`runId\`),
          KEY \`idx_obs_shipment\` (\`shipmentId\`),
          KEY \`idx_obs_tracking\` (\`trackingNumber\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `tracking_sync_observation`');
    await q.query('DROP TABLE IF EXISTS `tracking_sync_run`');
  }
}
```

- [ ] **Step 4: Write the failing test (offline: constructability + shape)**

```ts
// src/tracking-sync/entities.spec.ts
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';

describe('tracking-sync entities', () => {
  it('TrackingSyncRun is constructable and assignable', () => {
    const r = new TrackingSyncRun();
    r.mode = 'shadow';
    r.total = 10;
    expect(r.mode).toBe('shadow');
    expect(r.total).toBe(10);
  });

  it('TrackingSyncObservation is constructable and assignable', () => {
    const o = new TrackingSyncObservation();
    o.runId = 'run-1';
    o.shipmentId = 'ship-1';
    o.matchesLegacy = true;
    expect(o.runId).toBe('run-1');
    expect(o.matchesLegacy).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx jest tracking-sync/entities.spec --runInBand`
Expected: PASS (2 tests). Then verify compile: `npx tsc --noEmit`.

- [ ] **Step 6: Apply the migration against dev DB and confirm**

Run: `npm run typeorm -- migration:run -d src/data-source.ts` (or the repo's documented migration command).
Expected: `CreateTrackingSyncTables1786000000012` runs; both tables exist. Re-run once more → no-op (idempotent), no error.

> If the exact `typeorm` script name differs, inspect `package.json` `scripts` for the migration runner used by the team and use that. Do NOT enable `DB_SYNC`.

- [ ] **Step 7: Commit**

```bash
git add src/entities/tracking-sync-run.entity.ts src/entities/tracking-sync-observation.entity.ts src/database/migrations/1786000000012-CreateTrackingSyncTables.ts src/tracking-sync/entities.spec.ts
git commit -m "feat(tracking-sync): entities + migration for run/observation tables (shadow, no shipment_status change)"
```

---

## Task 3: TrackingNormalizer

**Files:**
- Create: `src/tracking-sync/tracking-normalizer.ts`
- Test: `src/tracking-sync/tracking-normalizer.spec.ts`

**Interfaces:**
- Consumes: `resolveCanonicalStatus` (`src/fedex-status/fedex-status.mapping.ts`), `buildEventKey`, `buildShadowKey`, types from Task 1.
- Produces: `class TrackingNormalizer { normalize(raw: RawTrackingResult): NormalizedTracking }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/tracking-normalizer.spec.ts
import { TrackingNormalizer } from './tracking-normalizer';
import { RawTrackingResult } from './tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function raw(): RawTrackingResult {
  return {
    trackingNumber: 'TN1',
    trackResults: [
      {
        latestStatusDetail: { derivedCode: 'DL', code: 'DL' },
        dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-08-14T20:00:00Z' }],
        scanEvents: [
          // Deliberadamente DESORDENADOS para probar el orden cronológico.
          { date: '2026-08-14T20:00:00Z', eventType: 'DL', derivedStatusCode: 'DL', eventDescription: 'Delivered', scanLocation: { city: 'Hermosillo' } },
          { date: '2026-08-12T09:00:00Z', eventType: 'PU', derivedStatusCode: 'PU', eventDescription: 'Picked up', scanLocation: { city: 'Nogales' } },
          { date: '2026-08-13T09:00:00Z', eventType: 'IT', derivedStatusCode: 'IT', eventDescription: 'In transit', scanLocation: { city: 'Nogales' } },
        ],
      },
    ],
  };
}

describe('TrackingNormalizer', () => {
  const n = new TrackingNormalizer();

  it('orders events chronologically ascending', () => {
    const out = n.normalize(raw());
    const times = out.events.map((e) => e.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(out.events).toHaveLength(3);
  });

  it('latest is the most recent event and maps to ENTREGADO', () => {
    const out = n.normalize(raw());
    expect(out.latest?.eventType).toBe('DL');
    expect(out.latest?.status).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('assigns eventKey and shadowKey to every event', () => {
    const out = n.normalize(raw());
    for (const e of out.events) {
      expect(e.eventKey).toMatch(/^[a-f0-9]{40}$/);
      expect(e.shadowKey).toContain('|');
    }
  });

  it('flags validation issues when there are no scanEvents', () => {
    const out = n.normalize({ trackingNumber: 'TN2', trackResults: [{ latestStatusDetail: null, scanEvents: [] }] });
    expect(out.validation.ok).toBe(false);
    expect(out.latest).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/tracking-normalizer.spec --runInBand`
Expected: FAIL — cannot find module `./tracking-normalizer`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/tracking-normalizer.ts
import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { resolveCanonicalStatus } from 'src/fedex-status/fedex-status.mapping';
import { buildEventKey, buildShadowKey } from './event-key.util';
import { NormalizedEvent, NormalizedTracking, RawTrackingResult, StatusValidation } from './tracking-sync.types';

/**
 * Convierte un trackResult crudo de FedEx en la lista COMPLETA de eventos normalizados,
 * ordenada cronológicamente. Reutiliza el mapeo canónico único. No toca la BD.
 */
@Injectable()
export class TrackingNormalizer {
  normalize(raw: RawTrackingResult): NormalizedTracking {
    const track = raw.trackResults?.[0] ?? null;
    const scanEvents: any[] = track?.scanEvents ?? [];

    const events: NormalizedEvent[] = scanEvents
      .map((s) => this.buildEvent(raw.trackingNumber, s))
      .filter((e): e is NormalizedEvent => e !== null)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const latest = events.length ? events[events.length - 1] : null;

    return {
      trackingNumber: raw.trackingNumber,
      events,
      latest,
      commitDateTime: this.extractCommitDateTime(track),
      validation: this.validate(track, events),
    };
  }

  private buildEvent(trackingNumber: string, scan: any): NormalizedEvent | null {
    if (!scan?.date) return null;
    const occurredAt = new Date(scan.date);
    if (isNaN(occurredAt.getTime())) return null;

    const derivedCode: string | null = scan.derivedStatusCode ?? null;
    const eventType: string | null = scan.eventType ?? null;
    const statusCode: string | null = scan.derivedStatusCode ?? scan.eventType ?? null;
    const exceptionCode: string | null = (scan.exceptionCode || '').trim() || null;
    const location: string | null = scan.scanLocation?.city ?? null;

    const status =
      resolveCanonicalStatus({ derivedCode, statusCode, exceptionCode }) ?? ShipmentStatusType.DESCONOCIDO;

    return {
      occurredAt,
      derivedCode,
      statusCode,
      exceptionCode,
      eventType,
      description: scan.eventDescription ?? null,
      location,
      status,
      eventKey: buildEventKey({ trackingNumber, occurredAt, derivedCode, eventType, exceptionCode, location }),
      shadowKey: buildShadowKey(occurredAt.getTime(), exceptionCode, status),
    };
  }

  private validate(track: any, events: NormalizedEvent[]): StatusValidation {
    const issues: string[] = [];
    if (track?.error?.message) issues.push(`FedEx error: ${track.error.message}`);
    if (!track?.latestStatusDetail) issues.push('Sin latestStatusDetail');
    if (events.length === 0) issues.push('Sin scanEvents');
    return { ok: issues.length === 0, issues };
  }

  private extractCommitDateTime(track: any): Date | null {
    if (!track) return null;
    const fromDateAndTimes = track.dateAndTimes?.find(
      (dt: any) => ['ESTIMATED_DELIVERY', 'COMMIT', 'APPOINTMENT_DELIVERY'].includes(dt.type),
    )?.dateTime;
    const rawDate =
      fromDateAndTimes ||
      track.estimatedDeliveryTimeWindow?.window?.ends ||
      track.standardTransitTimeWindow?.window?.ends;
    if (!rawDate) return null;
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? null : d;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/tracking-normalizer.spec --runInBand`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/tracking-normalizer.ts src/tracking-sync/tracking-normalizer.spec.ts
git commit -m "feat(tracking-sync): normalizer produces full chronologically-ordered event list"
```

---

## Task 4: EventReconciler

**Files:**
- Create: `src/tracking-sync/event-reconciler.ts`
- Test: `src/tracking-sync/event-reconciler.spec.ts`

**Interfaces:**
- Consumes: `NormalizedTracking`, `NormalizedEvent`, `ReconcileResult` from Task 1.
- Produces: `class EventReconciler { reconcile(normalized: NormalizedTracking, knownKeys: Set<string>, currentStatus: ShipmentStatusType, keyOf: (e: NormalizedEvent) => string): ReconcileResult }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/event-reconciler.spec.ts
import { EventReconciler } from './event-reconciler';
import { NormalizedEvent, NormalizedTracking } from './tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function ev(shadowKey: string, status: ShipmentStatusType, ms: number): NormalizedEvent {
  return {
    occurredAt: new Date(ms), derivedCode: null, statusCode: null, exceptionCode: null,
    eventType: null, description: null, location: null, status,
    eventKey: 'ek-' + shadowKey, shadowKey,
  };
}

function tracking(events: NormalizedEvent[]): NormalizedTracking {
  return { trackingNumber: 'TN', events, latest: events[events.length - 1] ?? null, commitDateTime: null, validation: { ok: true, issues: [] } };
}

describe('EventReconciler', () => {
  const r = new EventReconciler();
  const keyOf = (e: NormalizedEvent) => e.shadowKey;

  it('returns only events whose key is unknown', () => {
    const t = tracking([ev('a', ShipmentStatusType.RECOLECCION, 1), ev('b', ShipmentStatusType.EN_RUTA, 2)]);
    const out = r.reconcile(t, new Set(['a']), ShipmentStatusType.PENDIENTE, keyOf);
    expect(out.newEvents.map((e) => e.shadowKey)).toEqual(['b']);
  });

  it('is idempotent: all keys known → zero new events', () => {
    const t = tracking([ev('a', ShipmentStatusType.RECOLECCION, 1)]);
    const out = r.reconcile(t, new Set(['a']), ShipmentStatusType.RECOLECCION, keyOf);
    expect(out.newEvents).toHaveLength(0);
    expect(out.transition).toBeNull();
  });

  it('proposedStatus is the latest event status; sets transition when it differs', () => {
    const t = tracking([ev('a', ShipmentStatusType.RECOLECCION, 1), ev('b', ShipmentStatusType.EN_RUTA, 2)]);
    const out = r.reconcile(t, new Set(), ShipmentStatusType.PENDIENTE, keyOf);
    expect(out.proposedStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(out.transition).toEqual({ from: ShipmentStatusType.PENDIENTE, to: ShipmentStatusType.EN_RUTA });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/event-reconciler.spec --runInBand`
Expected: FAIL — cannot find module `./event-reconciler`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/event-reconciler.ts
import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { NormalizedEvent, NormalizedTracking, ReconcileResult } from './tracking-sync.types';

/**
 * Diff puro: dados los eventos normalizados y el set de claves ya conocidas, devuelve
 * los eventos nuevos (asc por fecha) y el estatus propuesto (último evento). Sin BD.
 * `keyOf` selecciona la clave a comparar (shadowKey en shadow, eventKey en cutover).
 */
@Injectable()
export class EventReconciler {
  reconcile(
    normalized: NormalizedTracking,
    knownKeys: Set<string>,
    currentStatus: ShipmentStatusType,
    keyOf: (e: NormalizedEvent) => string,
  ): ReconcileResult {
    const newEvents = normalized.events.filter((e) => !knownKeys.has(keyOf(e)));
    const proposedStatus = normalized.latest?.status ?? null;
    const transition =
      proposedStatus && proposedStatus !== currentStatus
        ? { from: currentStatus, to: proposedStatus }
        : null;

    return { newEvents, proposedStatus, currentStatus, transition };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/event-reconciler.spec --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/event-reconciler.ts src/tracking-sync/event-reconciler.spec.ts
git commit -m "feat(tracking-sync): pure event reconciler (idempotent diff)"
```

---

## Task 5: TerminalLockRule

**Files:**
- Create: `src/tracking-sync/rules/terminal-lock.rule.ts`
- Test: `src/tracking-sync/rules/terminal-lock.rule.spec.ts`

**Interfaces:**
- Consumes: `SyncRule`, `SyncContext` (Task 1), `TERMINAL_SHIPMENT_STATUSES`, `ShipmentStatusType`.
- Produces: `class TerminalLockRule implements SyncRule` (`name='terminal-lock'`, `priority=100`).

**Helper for building a `SyncContext` in tests** (repeated verbatim in later rule/pipeline tests — do not abbreviate):

```ts
// used across rule specs
import { SyncContext } from '../tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

export function makeCtx(overrides: { current: ShipmentStatusType; proposed: ShipmentStatusType | null; subsidiary?: any; events?: any[] }): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN', status: overrides.current, subsidiary: overrides.subsidiary } as any,
    normalized: { trackingNumber: 'TN', events: overrides.events ?? [], latest: null, commitDateTime: null, validation: { ok: true, issues: [] } },
    reconcile: { newEvents: [], proposedStatus: overrides.proposed, currentStatus: overrides.current, transition: null },
    proposedStatus: overrides.proposed,
    vetoedEventKeys: new Set<string>(),
    deferredEffects: [],
    notes: [],
  };
}
```

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/rules/terminal-lock.rule.spec.ts
import { TerminalLockRule } from './terminal-lock.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('TerminalLockRule', () => {
  const rule = new TerminalLockRule();

  it('blocks regression from a terminal status to an operative one', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.ENTREGADO, proposed: ShipmentStatusType.EN_RUTA });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(ctx.notes.join(' ')).toContain('Escudo Terminal');
  });

  it('always allows ENTREGADO to win', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.DEVUELTO_A_FEDEX, proposed: ShipmentStatusType.ENTREGADO });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('does nothing when current status is not terminal', () => {
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_BODEGA });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.EN_BODEGA);
  });
});
```

Also create `src/tracking-sync/rules/test-helpers.ts` with the `makeCtx` helper shown above.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/rules/terminal-lock.rule.spec --runInBand`
Expected: FAIL — cannot find module `./terminal-lock.rule`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/rules/terminal-lock.rule.ts
import { Injectable } from '@nestjs/common';
import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Impide que un estatus terminal (entregado/devuelto/retorno) retroceda a uno operativo.
 * Excepción: ENTREGADO siempre gana (aunque el actual sea otro terminal).
 */
@Injectable()
export class TerminalLockRule implements SyncRule {
  readonly name = 'terminal-lock';
  readonly priority = 100;

  apply(ctx: SyncContext): void {
    const current = ctx.shipment.status;
    const proposed = ctx.proposedStatus;
    if (!proposed) return;

    if (proposed === ShipmentStatusType.ENTREGADO) return; // entrega siempre gana

    const currentIsTerminal = TERMINAL_SHIPMENT_STATUSES.includes(current);
    const proposedIsTerminal = TERMINAL_SHIPMENT_STATUSES.includes(proposed);

    if (currentIsTerminal && !proposedIsTerminal) {
      ctx.notes.push(`Escudo Terminal: bloqueado retroceso ${current} → ${proposed}`);
      ctx.proposedStatus = current;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/rules/terminal-lock.rule.spec --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/rules/terminal-lock.rule.ts src/tracking-sync/rules/terminal-lock.rule.spec.ts src/tracking-sync/rules/test-helpers.ts
git commit -m "feat(tracking-sync): TerminalLockRule blocks terminal regressions"
```

---

## Task 6: ExternalDeliveryRule

**Files:**
- Create: `src/tracking-sync/rules/external-delivery.rule.ts`
- Test: `src/tracking-sync/rules/external-delivery.rule.spec.ts`

**Interfaces:**
- Consumes: `SyncRule`, `SyncContext`, `makeCtx` (Task 5 helper), `ShipmentStatusType`.
- Produces: `class ExternalDeliveryRule implements SyncRule` (`name='external-delivery'`, `priority=50`).

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/rules/external-delivery.rule.spec.ts
import { ExternalDeliveryRule } from './external-delivery.rule';
import { makeCtx } from './test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

const OD_EVENT = { eventType: 'OD', derivedCode: 'OD' };

describe('ExternalDeliveryRule', () => {
  const rule = new ExternalDeliveryRule();

  it('sets ACARGO_DE_FEDEX when subsidiary tracks external delivery and there is an OD event', () => {
    const ctx = makeCtx({
      current: ShipmentStatusType.EN_RUTA,
      proposed: ShipmentStatusType.EN_RUTA,
      subsidiary: { trackFedexExternalDelivery: true },
      events: [OD_EVENT],
    });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ACARGO_DE_FEDEX);
  });

  it('sets ENTREGADO_POR_FEDEX when delivered under external delivery', () => {
    const ctx = makeCtx({
      current: ShipmentStatusType.EN_RUTA,
      proposed: ShipmentStatusType.ENTREGADO,
      subsidiary: { trackFedexExternalDelivery: true },
      events: [OD_EVENT],
    });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO_POR_FEDEX);
  });

  it('does nothing when subsidiary does not track external delivery', () => {
    const ctx = makeCtx({
      current: ShipmentStatusType.EN_RUTA,
      proposed: ShipmentStatusType.ENTREGADO,
      subsidiary: { trackFedexExternalDelivery: false },
      events: [OD_EVENT],
    });
    rule.apply(ctx);
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/rules/external-delivery.rule.spec --runInBand`
Expected: FAIL — cannot find module `./external-delivery.rule`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/rules/external-delivery.rule.ts
import { Injectable } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Entrega por terceros (OD) según config de la sucursal (`trackFedexExternalDelivery`).
 * Si la sucursal lo rastrea y hay evento OD: en tránsito → ACARGO_DE_FEDEX;
 * entregado → ENTREGADO_POR_FEDEX. Si no lo rastrea, no hace nada.
 */
@Injectable()
export class ExternalDeliveryRule implements SyncRule {
  readonly name = 'external-delivery';
  readonly priority = 50;

  apply(ctx: SyncContext): void {
    const tracksExternal = !!(ctx.shipment.subsidiary as any)?.trackFedexExternalDelivery;
    if (!tracksExternal) return;

    const hasOd = ctx.normalized.events.some(
      (e: any) => e.eventType === 'OD' || e.derivedCode === 'OD',
    );
    if (!hasOd) return;

    if (ctx.proposedStatus === ShipmentStatusType.ENTREGADO) {
      ctx.proposedStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
      ctx.notes.push('OD: entrega por terceros → ENTREGADO_POR_FEDEX');
    } else if (ctx.proposedStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
      ctx.proposedStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
      ctx.notes.push('OD: FedEx tomó control → ACARGO_DE_FEDEX');
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/rules/external-delivery.rule.spec --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/rules/external-delivery.rule.ts src/tracking-sync/rules/external-delivery.rule.spec.ts
git commit -m "feat(tracking-sync): ExternalDeliveryRule (OD per subsidiary)"
```

---

## Task 7: Inactive rules + SYNC_RULES provider + SyncRulesPipeline

**Files:**
- Create: `src/tracking-sync/rules/income.rule.ts`
- Create: `src/tracking-sync/rules/notification.rule.ts`
- Create: `src/tracking-sync/sync-rules.pipeline.ts`
- Test: `src/tracking-sync/sync-rules.pipeline.spec.ts`

**Interfaces:**
- Consumes: `SyncRule`, `SyncContext`, `SYNC_RULES` token (Task 1), `makeCtx` helper.
- Produces: `class IncomeRule implements SyncRule` (`name='income'`, `priority=10`, INACTIVE), `class NotificationRule implements SyncRule` (`name='notification'`, `priority=5`, INACTIVE), `class SyncRulesPipeline { run(ctx: SyncContext): Promise<void> }`.

- [ ] **Step 1: Write the inactive IncomeRule**

```ts
// src/tracking-sync/rules/income.rule.ts
import { Injectable } from '@nestjs/common';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * HOOK FINANCIERO — DECLARADO PERO INACTIVO en shadow.
 * Cuando se active, encolará DeferredEffect { type: 'income', ... } que un ejecutor
 * fuera del pipeline procesará. Hoy es no-op deliberado (alcance: solo estatus).
 */
@Injectable()
export class IncomeRule implements SyncRule {
  readonly name = 'income';
  readonly priority = 10;
  readonly enabled = false;

  apply(_ctx: SyncContext): void {
    if (!this.enabled) return;
    // Intencionalmente vacío hasta la migración de reglas financieras.
  }
}
```

- [ ] **Step 2: Write the inactive NotificationRule**

```ts
// src/tracking-sync/rules/notification.rule.ts
import { Injectable } from '@nestjs/common';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * HOOK DE NOTIFICACIONES — DECLARADO PERO INACTIVO en shadow. No-op hasta activarse.
 */
@Injectable()
export class NotificationRule implements SyncRule {
  readonly name = 'notification';
  readonly priority = 5;
  readonly enabled = false;

  apply(_ctx: SyncContext): void {
    if (!this.enabled) return;
  }
}
```

- [ ] **Step 3: Write the failing pipeline test**

```ts
// src/tracking-sync/sync-rules.pipeline.spec.ts
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { SyncContext, SyncRule } from './tracking-sync.types';
import { makeCtx } from './rules/test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function recordingRule(name: string, priority: number, order: string[]): SyncRule {
  return { name, priority, apply: (_c) => { order.push(name); } };
}

describe('SyncRulesPipeline', () => {
  it('runs rules in descending priority order', async () => {
    const order: string[] = [];
    const pipeline = new SyncRulesPipeline([
      recordingRule('low', 5, order),
      recordingRule('high', 100, order),
      recordingRule('mid', 50, order),
    ]);
    await pipeline.run(makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA }));
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('lets an earlier rule affect a later one via shared context', async () => {
    const setDelivered: SyncRule = { name: 'a', priority: 100, apply: (c) => { c.proposedStatus = ShipmentStatusType.ENTREGADO; } };
    const readIt: SyncRule = { name: 'b', priority: 50, apply: (c) => { if (c.proposedStatus === ShipmentStatusType.ENTREGADO) c.notes.push('seen'); } };
    const ctx = makeCtx({ current: ShipmentStatusType.EN_RUTA, proposed: ShipmentStatusType.EN_RUTA });
    await new SyncRulesPipeline([readIt, setDelivered]).run(ctx);
    expect(ctx.notes).toContain('seen');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest tracking-sync/sync-rules.pipeline.spec --runInBand`
Expected: FAIL — cannot find module `./sync-rules.pipeline`.

- [ ] **Step 5: Write the pipeline implementation**

```ts
// src/tracking-sync/sync-rules.pipeline.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SyncContext, SyncRule, SYNC_RULES } from './tracking-sync.types';

/**
 * Ejecuta las reglas ordenadas por prioridad (mayor primero) sobre un SyncContext
 * compartido. Chain of Responsibility: cada regla lee/muta el contexto. Agregar una
 * regla = registrar un provider más en SYNC_RULES; el pipeline no cambia.
 */
@Injectable()
export class SyncRulesPipeline {
  private readonly logger = new Logger(SyncRulesPipeline.name);
  private readonly ordered: SyncRule[];

  constructor(@Inject(SYNC_RULES) rules: SyncRule[]) {
    this.ordered = [...(rules ?? [])].sort((a, b) => b.priority - a.priority);
  }

  async run(ctx: SyncContext): Promise<void> {
    for (const rule of this.ordered) {
      try {
        await rule.apply(ctx);
      } catch (err: any) {
        this.logger.warn(`Regla '${rule.name}' falló para ${ctx.shipment.trackingNumber}: ${err?.message}`);
        ctx.notes.push(`rule:${rule.name} error:${err?.message}`);
      }
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tracking-sync/sync-rules.pipeline.spec --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/tracking-sync/rules/income.rule.ts src/tracking-sync/rules/notification.rule.ts src/tracking-sync/sync-rules.pipeline.ts src/tracking-sync/sync-rules.pipeline.spec.ts
git commit -m "feat(tracking-sync): rules pipeline + inactive income/notification hooks"
```

---

## Task 8: FedexTrackingSource (generation selector)

**Files:**
- Create: `src/tracking-sync/sources/fedex-tracking.source.ts`
- Test: `src/tracking-sync/sources/fedex-tracking.source.spec.ts`

**Interfaces:**
- Consumes: `TrackingSource`, `TrackingRef`, `RawTrackingResult` (Task 1), `FedexService` (`src/shipments/fedex.service.ts`, method `trackBatch(items, context): Promise<Map<string, any[]>>`).
- Produces: `class FedexTrackingSource implements TrackingSource`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/sources/fedex-tracking.source.spec.ts
import { FedexTrackingSource } from './fedex-tracking.source';

describe('FedexTrackingSource', () => {
  it('picks the highest-sequence generation when FedEx returns several trackResults', async () => {
    const fedex = {
      trackBatch: jest.fn().mockResolvedValue(
        new Map([
          ['TN1', [
            { trackingNumberInfo: { trackingNumberUniqueId: '2453~old' }, scanEvents: [{ date: '2026-08-10T00:00:00Z' }] },
            { trackingNumberInfo: { trackingNumberUniqueId: '2456~new' }, scanEvents: [{ date: '2026-08-14T00:00:00Z' }] },
          ]],
        ]),
      ),
    } as any;

    const source = new FedexTrackingSource(fedex);
    const [res] = await source.fetch([{ trackingNumber: 'TN1' }]);
    expect(res.trackResults).toHaveLength(1);
    expect(res.trackResults[0].trackingNumberInfo.trackingNumberUniqueId).toBe('2456~new');
  });

  it('returns empty trackResults when FedEx has no data for a tracking', async () => {
    const fedex = { trackBatch: jest.fn().mockResolvedValue(new Map()) } as any;
    const source = new FedexTrackingSource(fedex);
    const [res] = await source.fetch([{ trackingNumber: 'MISSING' }]);
    expect(res.trackResults).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/sources/fedex-tracking.source.spec --runInBand`
Expected: FAIL — cannot find module `./fedex-tracking.source`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/sources/fedex-tracking.source.ts
import { Injectable } from '@nestjs/common';
import { FedexService } from 'src/shipments/fedex.service';
import { RawTrackingResult, TrackingRef, TrackingSource } from '../tracking-sync.types';

/**
 * Única capa que conoce FedEx. Envuelve FedexService.trackBatch (token/backoff/429 ya
 * resueltos) y aplica el SELECTOR DE GENERACIÓN: si FedEx devuelve varias generaciones
 * de una guía reciclada, elige la de mayor secuencia (desempate por último scan).
 */
@Injectable()
export class FedexTrackingSource implements TrackingSource {
  private static readonly BATCH = 30;

  constructor(private readonly fedexService: FedexService) {}

  async fetch(refs: TrackingRef[]): Promise<RawTrackingResult[]> {
    const out: RawTrackingResult[] = [];
    for (let i = 0; i < refs.length; i += FedexTrackingSource.BATCH) {
      const slice = refs.slice(i, i + FedexTrackingSource.BATCH);
      const map = await this.fedexService.trackBatch(
        slice.map((r) => ({ trackingNumber: r.trackingNumber, fedexUniqueId: r.fedexUniqueId, carrierCode: r.carrierCode })),
        'tracking-sync',
      );
      for (const ref of slice) {
        const results = map.get(ref.trackingNumber) || [];
        const winner = this.pickGeneration(results);
        out.push({ trackingNumber: ref.trackingNumber, trackResults: winner ? [winner] : [] });
      }
    }
    return out;
  }

  private pickGeneration(results: any[]): any | null {
    if (!results?.length) return null;
    if (results.length === 1) return results[0];
    return [...results].sort((a, b) => {
      const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0', 10);
      const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0', 10);
      if (seqA !== seqB) return seqB - seqA;
      const tA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
      const tB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
      return tB - tA;
    })[0];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/sources/fedex-tracking.source.spec --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/sources/fedex-tracking.source.ts src/tracking-sync/sources/fedex-tracking.source.spec.ts
git commit -m "feat(tracking-sync): FedexTrackingSource with generation selector"
```

---

## Task 9: ShadowSyncSink

**Files:**
- Create: `src/tracking-sync/sinks/shadow-sync.sink.ts`
- Test: `src/tracking-sync/sinks/shadow-sync.sink.spec.ts`

**Interfaces:**
- Consumes: `SyncSink`, `SyncContext`, `SinkOutcome` (Task 1), `TrackingSyncObservation` entity (Task 2), TypeORM `Repository`.
- Produces: `class ShadowSyncSink implements SyncSink { applyPlan(ctx, runId): Promise<SinkOutcome> }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tracking-sync/sinks/shadow-sync.sink.spec.ts
import { ShadowSyncSink } from './shadow-sync.sink';
import { SyncContext } from '../tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function ctx(proposed: ShipmentStatusType, current: ShipmentStatusType, newEventKeys: string[]): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN', status: current } as any,
    normalized: { trackingNumber: 'TN', events: [], latest: null, commitDateTime: null, validation: { ok: true, issues: ['x'] } },
    reconcile: {
      newEvents: newEventKeys.map((k) => ({ eventKey: k } as any)),
      proposedStatus: proposed, currentStatus: current, transition: null,
    },
    proposedStatus: proposed,
    vetoedEventKeys: new Set<string>(),
    deferredEffects: [],
    notes: [],
  };
}

describe('ShadowSyncSink', () => {
  it('records what it WOULD do and computes matchesLegacy + wouldInsert count', async () => {
    const repo = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = new ShadowSyncSink(repo);

    const out = await sink.applyPlan(ctx(ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_RUTA, ['k1', 'k2']), 'run-1');

    expect(out.wouldInsertEvents).toBe(2);
    expect(out.matchesLegacy).toBe(true); // proposed === current
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    const [row, conflict] = repo.upsert.mock.calls[0];
    expect(row).toMatchObject({ runId: 'run-1', shipmentId: 's1', trackingNumber: 'TN', wouldInsertEvents: 2, matchesLegacy: true });
    expect(conflict).toEqual(['runId', 'shipmentId']); // idempotent
  });

  it('excludes vetoed events from the wouldInsert count', async () => {
    const repo = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const sink = new ShadowSyncSink(repo);
    const c = ctx(ShipmentStatusType.ENTREGADO, ShipmentStatusType.EN_RUTA, ['k1', 'k2']);
    c.vetoedEventKeys.add('k1');
    const out = await sink.applyPlan(c, 'run-1');
    expect(out.wouldInsertEvents).toBe(1);
    expect(out.matchesLegacy).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/sinks/shadow-sync.sink.spec --runInBand`
Expected: FAIL — cannot find module `./shadow-sync.sink`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tracking-sync/sinks/shadow-sync.sink.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';
import { SinkOutcome, SyncContext, SyncSink } from '../tracking-sync.types';

/**
 * Sink de SHADOW: NO toca shipment ni shipment_status. Registra en tracking_sync_observation
 * lo que el motor HARÍA. Idempotente por (runId, shipmentId) vía upsert.
 */
@Injectable()
export class ShadowSyncSink implements SyncSink {
  constructor(
    @InjectRepository(TrackingSyncObservation)
    private readonly observationRepo: Repository<TrackingSyncObservation>,
  ) {}

  async applyPlan(ctx: SyncContext, runId: string): Promise<SinkOutcome> {
    const toInsert = ctx.reconcile.newEvents.filter((e) => !ctx.vetoedEventKeys.has(e.eventKey));
    const matchesLegacy = ctx.proposedStatus === ctx.shipment.status;

    const row = {
      runId,
      shipmentId: ctx.shipment.id,
      trackingNumber: ctx.shipment.trackingNumber,
      proposedStatus: ctx.proposedStatus ?? null,
      legacyCurrentStatus: ctx.shipment.status ?? null,
      wouldInsertEvents: toInsert.length,
      wouldInsertEventKeys: JSON.stringify(toInsert.map((e) => e.eventKey)),
      matchesLegacy,
      issues: JSON.stringify(ctx.normalized.validation.issues ?? []),
    };

    await this.observationRepo.upsert(row as any, ['runId', 'shipmentId']);

    return {
      shipmentId: ctx.shipment.id,
      trackingNumber: ctx.shipment.trackingNumber,
      proposedStatus: ctx.proposedStatus,
      wouldInsertEvents: toInsert.length,
      matchesLegacy,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tracking-sync/sinks/shadow-sync.sink.spec --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracking-sync/sinks/shadow-sync.sink.ts src/tracking-sync/sinks/shadow-sync.sink.spec.ts
git commit -m "feat(tracking-sync): ShadowSyncSink records plan idempotently (no shipment writes)"
```

---

## Task 10: ExistingEventLoader + TrackingSyncOrchestrator

**Files:**
- Create: `src/tracking-sync/existing-event-loader.ts`
- Create: `src/tracking-sync/tracking-sync.orchestrator.ts`
- Test: `src/tracking-sync/existing-event-loader.spec.ts`
- Test: `src/tracking-sync/tracking-sync.orchestrator.spec.ts`

**Interfaces:**
- Consumes: `TrackingSource`, `TrackingNormalizer`, `EventReconciler`, `SyncRulesPipeline`, `SyncSink`, `buildShadowKey`, `TrackingSyncRun` repo, `ShipmentStatus` repo (read-only), `Shipment[]`.
- Produces: `class ExistingEventLoader { load(shipmentId: string): Promise<Set<string>> }`, `class TrackingSyncOrchestrator { runShadow(shipments: Shipment[]): Promise<{ runId: string; ok: number; noData: number; failed: number; aborted: boolean }> }`.

- [ ] **Step 1: Write the failing ExistingEventLoader test**

```ts
// src/tracking-sync/existing-event-loader.spec.ts
import { ExistingEventLoader } from './existing-event-loader';
import { buildShadowKey } from './event-key.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('ExistingEventLoader', () => {
  it('builds a set of shadowKeys from existing shipment_status rows', async () => {
    const ts = new Date('2026-08-14T20:00:00Z');
    const repo = {
      find: jest.fn().mockResolvedValue([
        { timestamp: ts, exceptionCode: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE },
      ]),
    } as any;
    const loader = new ExistingEventLoader(repo);
    const keys = await loader.load('s1');
    expect(keys.has(buildShadowKey(ts.getTime(), '08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tracking-sync/existing-event-loader.spec --runInBand`
Expected: FAIL — cannot find module `./existing-event-loader`.

- [ ] **Step 3: Write the ExistingEventLoader**

```ts
// src/tracking-sync/existing-event-loader.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { buildShadowKey } from './event-key.util';

/**
 * Lee (READ-ONLY) el historial existente de shipment_status y construye el set de
 * shadowKeys ya conocidos, para que el Reconciler detecte eventos nuevos en shadow
 * sin necesitar la columna eventKey (que no existe hasta el cutover).
 */
@Injectable()
export class ExistingEventLoader {
  constructor(
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepo: Repository<ShipmentStatus>,
  ) {}

  async load(shipmentId: string): Promise<Set<string>> {
    const rows = await this.shipmentStatusRepo.find({
      where: { shipment: { id: shipmentId } },
      select: ['timestamp', 'exceptionCode', 'status'],
    });
    const set = new Set<string>();
    for (const r of rows) {
      set.add(buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status));
    }
    return set;
  }
}
```

- [ ] **Step 4: Run the loader test to verify it passes**

Run: `npx jest tracking-sync/existing-event-loader.spec --runInBand`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing orchestrator test**

```ts
// src/tracking-sync/tracking-sync.orchestrator.spec.ts
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

function deps() {
  const savedRun: any = { id: 'run-1' };
  return {
    runRepo: {
      create: jest.fn().mockImplementation((x) => ({ ...x })),
      save: jest.fn().mockImplementation(async (x) => ({ ...x, id: x.id ?? 'run-1' })),
    },
    source: { fetch: jest.fn() },
    normalizer: { normalize: jest.fn() },
    reconciler: { reconcile: jest.fn() },
    pipeline: { run: jest.fn().mockResolvedValue(undefined) },
    sink: { applyPlan: jest.fn().mockResolvedValue({ shipmentId: 's1', trackingNumber: 'TN1', proposedStatus: ShipmentStatusType.EN_RUTA, wouldInsertEvents: 1, matchesLegacy: true }) },
    loader: { load: jest.fn().mockResolvedValue(new Set<string>()) },
    savedRun,
  };
}

describe('TrackingSyncOrchestrator', () => {
  it('counts ok vs noData and finalizes the run', async () => {
    const d = deps();
    d.source.fetch.mockResolvedValue([
      { trackingNumber: 'TN1', trackResults: [{}] },
      { trackingNumber: 'TN2', trackResults: [] }, // sin datos
    ]);
    d.normalizer.normalize.mockImplementation((raw: any) => ({
      trackingNumber: raw.trackingNumber, events: raw.trackResults.length ? [{}] : [],
      latest: raw.trackResults.length ? { status: ShipmentStatusType.EN_RUTA } : null,
      commitDateTime: null, validation: { ok: true, issues: [] },
    }));
    d.reconciler.reconcile.mockReturnValue({ newEvents: [{ eventKey: 'k1' }], proposedStatus: ShipmentStatusType.EN_RUTA, currentStatus: ShipmentStatusType.EN_RUTA, transition: null });

    const orch = new TrackingSyncOrchestrator(d.runRepo as any, d.source as any, d.normalizer as any, d.reconciler as any, d.pipeline as any, d.sink as any, d.loader as any);
    const shipments = [
      { id: 's1', trackingNumber: 'TN1', status: ShipmentStatusType.EN_RUTA } as any,
      { id: 's2', trackingNumber: 'TN2', status: ShipmentStatusType.PENDIENTE } as any,
    ];
    const res = await orch.runShadow(shipments);

    expect(res.ok).toBe(1);
    expect(res.noData).toBe(1);
    expect(res.aborted).toBe(false);
    expect(d.sink.applyPlan).toHaveBeenCalledTimes(1);
    expect(d.runRepo.save).toHaveBeenCalled(); // run persisted (start + finalize)
  });

  it('aborts (circuit breaker) when the source throws a connectivity error and nothing succeeds', async () => {
    const d = deps();
    d.source.fetch.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    const orch = new TrackingSyncOrchestrator(d.runRepo as any, d.source as any, d.normalizer as any, d.reconciler as any, d.pipeline as any, d.sink as any, d.loader as any);
    const res = await orch.runShadow([{ id: 's1', trackingNumber: 'TN1', status: ShipmentStatusType.EN_RUTA } as any]);
    expect(res.aborted).toBe(true);
    expect(res.ok).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tracking-sync/tracking-sync.orchestrator.spec --runInBand`
Expected: FAIL — cannot find module `./tracking-sync.orchestrator`.

- [ ] **Step 7: Write the orchestrator**

```ts
// src/tracking-sync/tracking-sync.orchestrator.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import pLimit from 'p-limit';
import { Shipment } from 'src/entities/shipment.entity';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { ExistingEventLoader } from './existing-event-loader';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { ShadowSyncSink } from './sinks/shadow-sync.sink';
import { NormalizedEvent, SyncContext, TrackingSource, SyncSink } from './tracking-sync.types';

/**
 * Conduce el pipeline sobre muchas guías: batching, concurrencia controlada, circuit
 * breaker por conectividad, dead-letter y métricas por corrida (tracking_sync_run).
 */
@Injectable()
export class TrackingSyncOrchestrator {
  private readonly logger = new Logger(TrackingSyncOrchestrator.name);
  private static readonly BATCH = 250;
  private static readonly CONCURRENCY = 6;
  private static readonly NET_ERROR_ABORT_THRESHOLD = 5;

  constructor(
    @InjectRepository(TrackingSyncRun) private readonly runRepo: Repository<TrackingSyncRun>,
    private readonly source: FedexTrackingSource,
    private readonly normalizer: TrackingNormalizer,
    private readonly reconciler: EventReconciler,
    private readonly pipeline: SyncRulesPipeline,
    private readonly sink: ShadowSyncSink,
    private readonly loader: ExistingEventLoader,
  ) {}

  async runShadow(shipments: Shipment[]) {
    const run = await this.runRepo.save(
      this.runRepo.create({ startedAt: new Date(), mode: 'shadow', total: shipments.length }),
    );

    const byTracking = new Map<string, Shipment[]>();
    for (const s of shipments) {
      const arr = byTracking.get(s.trackingNumber) ?? [];
      arr.push(s);
      byTracking.set(s.trackingNumber, arr);
    }
    const trackingNumbers = [...byTracking.keys()];

    const limit = pLimit(TrackingSyncOrchestrator.CONCURRENCY);
    let ok = 0, noData = 0, failed = 0, matches = 0, diverges = 0, netErrors = 0;
    let aborted = false;

    for (let i = 0; i < trackingNumbers.length; i += TrackingSyncOrchestrator.BATCH) {
      if (aborted) break;
      const batch = trackingNumbers.slice(i, i + TrackingSyncOrchestrator.BATCH);

      let raws;
      try {
        raws = await this.source.fetch(batch.map((tn) => this.refFor(byTracking.get(tn)![0])));
      } catch (err: any) {
        netErrors += batch.length ? 1 : 0;
        this.logger.error(`Fallo de fetch en lote: ${err?.message}`);
        if (ok === 0 && this.isConnectivity(err)) {
          aborted = true;
          break;
        }
        continue;
      }

      const rawByTn = new Map(raws.map((r) => [r.trackingNumber, r]));

      await Promise.all(
        batch.map((tn) =>
          limit(async () => {
            const raw = rawByTn.get(tn);
            const group = byTracking.get(tn)!;
            if (!raw || raw.trackResults.length === 0) { noData++; return; }
            try {
              const normalized = this.normalizer.normalize(raw);
              if (!normalized.latest) { noData++; return; }

              const shipment = group[0];
              const knownKeys = await this.loader.load(shipment.id);
              const reconcile = this.reconciler.reconcile(
                normalized, knownKeys, shipment.status, (e: NormalizedEvent) => e.shadowKey,
              );

              const ctx: SyncContext = {
                shipment, normalized, reconcile,
                proposedStatus: reconcile.proposedStatus,
                vetoedEventKeys: new Set<string>(), deferredEffects: [], notes: [],
              };
              await this.pipeline.run(ctx);
              const outcome = await this.sink.applyPlan(ctx, run.id);
              outcome.matchesLegacy ? matches++ : diverges++;
              ok++;
            } catch (err: any) {
              failed++;
              this.logger.warn(`[${tn}] shadow falló: ${err?.message}`);
            }
          }),
        ),
      );
    }

    run.finishedAt = new Date();
    run.ok = ok; run.noData = noData; run.failed = failed;
    run.aborted = aborted; run.matchesLegacy = matches; run.divergesLegacy = diverges;
    await this.runRepo.save(run);

    this.logger.log(`🏁 [shadow] run ${run.id}: ok=${ok} noData=${noData} failed=${failed} match=${matches} diverge=${diverges} aborted=${aborted}`);
    return { runId: run.id, ok, noData, failed, aborted };
  }

  private refFor(s: Shipment) {
    return { trackingNumber: s.trackingNumber, fedexUniqueId: s.fedexUniqueId, carrierCode: s.carrierCode };
  }

  private isConnectivity(err: any): boolean {
    const code = err?.code || '';
    return ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
  }
}
```

> Note: `p-limit` import — CONFIRMED the repo uses `import pLimit from 'p-limit'` (`shipments.service.ts:49`). Use exactly that form.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest tracking-sync/tracking-sync.orchestrator.spec --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/tracking-sync/existing-event-loader.ts src/tracking-sync/existing-event-loader.spec.ts src/tracking-sync/tracking-sync.orchestrator.ts src/tracking-sync/tracking-sync.orchestrator.spec.ts
git commit -m "feat(tracking-sync): orchestrator (batching, breaker, metrics) + existing-event loader"
```

---

## Task 11: Cron + Module wiring + app registration

**Files:**
- Create: `src/tracking-sync/tracking-sync.cron.ts`
- Create: `src/tracking-sync/tracking-sync.module.ts`
- Modify: `src/app.module.ts` (add `TrackingSyncModule` to `imports`)
- Test: `src/tracking-sync/tracking-sync.module.spec.ts`

**Interfaces:**
- Consumes: everything above; `ShipmentsService.getShipmentsToValidate()` (read-only universe of shipments); `@nestjs/schedule` `Cron`.
- Produces: `class TrackingSyncCron`, `class TrackingSyncModule`.

- [ ] **Step 1: Write the cron**

```ts
// src/tracking-sync/tracking-sync.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';

/**
 * Corre en SHADOW cada hora al minuto :15 (desfasado del cron legacy en :00 para no
 * competir por cuota de FedEx). Solo lee el universo de guías; no cambia estatus real.
 */
@Injectable()
export class TrackingSyncCron {
  private readonly logger = new Logger(TrackingSyncCron.name);
  private isRunning = false;

  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly orchestrator: TrackingSyncOrchestrator,
  ) {}

  @Cron('0 15 * * * *', { timeZone: 'America/Hermosillo' })
  async handleShadowSync() {
    if (this.isRunning) {
      this.logger.warn('⏭️ [shadow] corrida anterior en curso; se omite este disparo.');
      return;
    }
    this.isRunning = true;
    try {
      const shipments = await this.shipmentsService.getShipmentsToValidate();
      if (!shipments.length) {
        this.logger.log('📪 [shadow] no hay guías para observar.');
        return;
      }
      this.logger.log(`🌓 [shadow] observando ${shipments.length} guías FedEx...`);
      await this.orchestrator.runShadow(shipments);
    } catch (err: any) {
      this.logger.error(`❌ [shadow] error: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
```

- [ ] **Step 2: Write the module**

```ts
// src/tracking-sync/tracking-sync.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsModule } from 'src/shipments/shipments.module';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { ExistingEventLoader } from './existing-event-loader';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { ShadowSyncSink } from './sinks/shadow-sync.sink';
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { TrackingSyncCron } from './tracking-sync.cron';
import { TerminalLockRule } from './rules/terminal-lock.rule';
import { ExternalDeliveryRule } from './rules/external-delivery.rule';
import { IncomeRule } from './rules/income.rule';
import { NotificationRule } from './rules/notification.rule';
import { SYNC_RULES } from './tracking-sync.types';

/**
 * Motor de sincronización de estados de tracking (FedEx), SHADOW mode.
 * Aislado del monolito shipments.service. Las reglas se inyectan por el token SYNC_RULES;
 * agregar una regla = un provider más aquí, sin tocar el pipeline.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentStatus, TrackingSyncRun, TrackingSyncObservation]),
    ShipmentsModule, // para ShipmentsService.getShipmentsToValidate()
  ],
  providers: [
    FedexService,
    TrackingNormalizer,
    EventReconciler,
    SyncRulesPipeline,
    ExistingEventLoader,
    FedexTrackingSource,
    ShadowSyncSink,
    TrackingSyncOrchestrator,
    TrackingSyncCron,
    TerminalLockRule,
    ExternalDeliveryRule,
    IncomeRule,
    NotificationRule,
    {
      provide: SYNC_RULES,
      useFactory: (terminal, external, income, notification) => [terminal, external, income, notification],
      inject: [TerminalLockRule, ExternalDeliveryRule, IncomeRule, NotificationRule],
    },
  ],
})
export class TrackingSyncModule {}
```

> CONFIRMED: `src/shipments/shipments.module.ts:23` already `exports: [ShipmentsService]`. No change to that module is needed — just `imports: [ShipmentsModule]` here.

- [ ] **Step 3: Write the module smoke test**

```ts
// src/tracking-sync/tracking-sync.module.spec.ts
import { TerminalLockRule } from './rules/terminal-lock.rule';
import { ExternalDeliveryRule } from './rules/external-delivery.rule';
import { IncomeRule } from './rules/income.rule';
import { NotificationRule } from './rules/notification.rule';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { makeCtx } from './rules/test-helpers';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('rules registration order + inactive hooks', () => {
  it('assembles all four rules and runs terminal-lock first, income/notification are no-ops', async () => {
    const rules = [new TerminalLockRule(), new ExternalDeliveryRule(), new IncomeRule(), new NotificationRule()];
    const pipeline = new SyncRulesPipeline(rules);
    const ctx = makeCtx({ current: ShipmentStatusType.ENTREGADO, proposed: ShipmentStatusType.EN_RUTA });
    await pipeline.run(ctx);
    // TerminalLock (priority 100) blocked the regression; income/notification did nothing.
    expect(ctx.proposedStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(ctx.deferredEffects).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Register the module in `app.module.ts`**

Open `src/app.module.ts`, add the import and include `TrackingSyncModule` in the `imports` array:

```ts
import { TrackingSyncModule } from './tracking-sync/tracking-sync.module';
// ...
@Module({
  imports: [
    // ...existing imports...
    TrackingSyncModule,
  ],
})
```

- [ ] **Step 5: Run tests + compile + boot check**

Run: `npx jest tracking-sync --runInBand` (whole suite for the module)
Expected: PASS (all specs).
Run: `npx tsc --noEmit`
Expected: no type errors.
Run: `npm run start:dev` (or the repo's dev boot) and confirm log line `🌓 [shadow]` cron scheduled and Nest boots without DI errors. Stop after confirming boot.

- [ ] **Step 6: Commit**

```bash
git add src/tracking-sync/tracking-sync.cron.ts src/tracking-sync/tracking-sync.module.ts src/tracking-sync/tracking-sync.module.spec.ts src/app.module.ts
git commit -m "feat(tracking-sync): cron (shadow :15) + module wiring + app registration"
```

- [ ] **Step 7: Update graphify graph (per CLAUDE.md)**

Run: `graphify update .`

---

## Self-Review Notes (author checklist — already applied)

- **Spec coverage:** Source→§4.1 (T8), Normalizer→§4.2 (T3), Reconciler→§4.3 (T4), eventKey→§4.4 (T1), Rules pipeline→§4.5 (T5–T7), Sink shadow→§4.6 (T9), Orchestrator→§4.7 (T10), Metrics→§4.8 (T10 run entity), DB tables→§5.1 (T2), no shipment_status change→enforced in T2/T9, cron :15→§7 (T11), extensibility & inactive hooks→§8 (T7/T11), duplicates/errors/retries/concurrency→§6 (T10), testing→§10 (each task).
- **Deferred to cutover (out of scope, not in this plan):** `shipment_status.eventKey`/`source` columns + `PersistentSyncSink` (§5.2). Explicitly NOT implemented here.
- **Type consistency:** `matchesLegacy` (bool on outcome/observation, int counter on run), `shadowKey`/`eventKey` on every `NormalizedEvent`, `SyncSink.applyPlan(ctx, runId)`, `TrackingSource.fetch(refs)`, `SYNC_RULES` token — consistent across tasks.
