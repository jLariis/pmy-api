# Server Power Schedule — Implementation Plan (pmy-api)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el superadmin configure desde la app (Configuración → Servidor) la suspensión (default 21:30) y el despertar (default 06:00) automáticos del servidor Ubuntu físico, de lunes a sábado (días editables), con alertas por correo al suspender y al despertar.

**Architecture:** systemd + `rtcwake` hacen el suspend/wake real en el SO. La app persiste la config en BD (`server_power_schedule` + una fila por día en `server_power_day`), la deriva a `/var/lib/pmy-power/desired.json` y la aplica con un único `sudo /usr/local/sbin/pmy-power-apply`. Los correos los manda `MailService` (SMTP existente) invocado por hooks locales de `systemd-sleep` contra un endpoint interno protegido por secreto.

**Tech Stack:** NestJS + TypeORM (MySQL), Jest, systemd, rtcwake, bash.

## Global Constraints

- `DB_SYNC=false` en TODOS los entornos: el esquema SOLO por migración. (regla del repo)
- Solo **superadmin** puede leer/editar el horario: usar `SuperAdminGuard` (`src/audit/super-admin.guard.ts`).
- El endpoint interno de notificación NO usa JWT: `@Public()` + `PowerSecretGuard` (header `X-Power-Secret`) + `@NoAudit()`.
- La app **nunca** ejecuta `rtcwake`/`systemctl suspend` directo: solo `sudo /usr/local/sbin/pmy-power-apply` (sudoers acotado).
- **Nunca** suspender sin alarma RTC armada (salvaguarda anti "dormido para siempre").
- Entidades se autoregistran por glob `src/entities/*.entity.{js,ts}` (`src/config/config.ts:19`).
- Correos default a: `javier.rappaz@gmail.com`, `josejuanurena@paqueteriaymensajeriadelyaqui.com`, `sistemas@paqueteriaymensajeriadelyaqui.com`.
- Días: ISO weekday `1=Lun … 7=Dom`. Migración siembra 1–6 `active=1`, 7 `active=0`.
- Rama: `feat/server-power-schedule`.
- Commits terminan con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- Create `src/entities/server-power-schedule.entity.ts` — config global (single row).
- Create `src/entities/server-power-day.entity.ts` — una fila por día (7).
- Modify `src/entities/index.ts` — exportar ambas.
- Create `src/database/migrations/1786000000073-CreateServerPowerSchedule.ts` — tablas + seed.
- Create `src/server-stats/power/power-schedule.util.ts` — helpers puros (validación, OnCalendar, next-event, desired.json).
- Create `src/server-stats/power/power-schedule.util.spec.ts` — tests del util.
- Create `src/server-stats/power/dto/update-power-schedule.dto.ts` — DTO validado.
- Create `src/server-stats/power/power-secret.guard.ts` — guard por secreto.
- Create `src/server-stats/power/power-apply.runner.ts` — wrapper de I/O (fs write + spawn + systemctl is-active).
- Create `src/server-stats/power/server-power.service.ts` — orquestación.
- Create `src/server-stats/power/server-power.service.spec.ts` — tests del service (runner y mail mockeados).
- Create `src/server-stats/power/server-power.controller.ts` — endpoints.
- Modify `src/server-stats/server-stats.module.ts` — wiring.
- Create `deploy/setup-power-schedule.sh` — provisioning idempotente (instala scripts, unidades, sudoers).
- Create `deploy/README-power-schedule.md` — instrucciones.

---

## Task 1: Entidades + migración (esquema)

**Files:**
- Create: `src/entities/server-power-schedule.entity.ts`
- Create: `src/entities/server-power-day.entity.ts`
- Modify: `src/entities/index.ts`
- Create: `src/database/migrations/1786000000073-CreateServerPowerSchedule.ts`

**Interfaces:**
- Produces: entidades `ServerPowerSchedule { id, enabled, suspendTime, wakeTime, recipients, lastAppliedAt, lastApplyError, updatedById, createdAt, updatedAt }` y `ServerPowerDay { id, dayOfWeek, active }`.

- [ ] **Step 1: Crear `server-power-schedule.entity.ts`**

```ts
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('server_power_schedule')
export class ServerPowerSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** HH:MM en hora local del servidor. */
  @Column({ type: 'varchar', length: 5, default: '21:30' })
  suspendTime: string;

  /** HH:MM en hora local del servidor. */
  @Column({ type: 'varchar', length: 5, default: '06:00' })
  wakeTime: string;

  /** Destinatarios de las alertas. */
  @Column({ type: 'json', nullable: true })
  recipients: string[] | null;

  @Column({ type: 'datetime', nullable: true })
  lastAppliedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastApplyError: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Crear `server-power-day.entity.ts`**

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Una fila por día de la semana. dayOfWeek: 1=Lun … 7=Dom. */
@Entity('server_power_day')
export class ServerPowerDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'tinyint' })
  dayOfWeek: number;

  /** ¿Se suspende esa noche? */
  @Column({ type: 'boolean', default: true })
  active: boolean;
}
```

- [ ] **Step 3: Exportar en `src/entities/index.ts`** (agregar al final)

```ts
export * from './server-power-schedule.entity';
export * from './server-power-day.entity';
```

- [ ] **Step 4: Crear migración `1786000000073-CreateServerPowerSchedule.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * Suspensión/despertar programado del servidor.
 *  - `server_power_schedule` (fila única): enabled + horas + recipients + trazabilidad de apply.
 *  - `server_power_day` (7 filas, una por día ISO 1..7): flag `active` por noche.
 * Siembra: settings default (21:30 / 06:00 / 3 correos), días 1–6 activos, 7 inactivo.
 */
export class CreateServerPowerSchedule1786000000073 implements MigrationInterface {
  name = 'CreateServerPowerSchedule1786000000073';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(qr: QueryRunner): Promise<void> {
    if (!(await this.tableExists(qr, 'server_power_schedule'))) {
      await qr.query(`
        CREATE TABLE \`server_power_schedule\` (
          \`id\` varchar(36) NOT NULL,
          \`enabled\` tinyint(1) NOT NULL DEFAULT 1,
          \`suspendTime\` varchar(5) NOT NULL DEFAULT '21:30',
          \`wakeTime\` varchar(5) NOT NULL DEFAULT '06:00',
          \`recipients\` json NULL,
          \`lastAppliedAt\` datetime NULL,
          \`lastApplyError\` text NULL,
          \`updatedById\` varchar(36) NULL,
          \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    const schedCount = await qr.query(`SELECT COUNT(*) AS c FROM \`server_power_schedule\``);
    if (Number(schedCount[0].c) === 0) {
      const recipients = JSON.stringify([
        'javier.rappaz@gmail.com',
        'josejuanurena@paqueteriaymensajeriadelyaqui.com',
        'sistemas@paqueteriaymensajeriadelyaqui.com',
      ]);
      await qr.query(
        `INSERT INTO \`server_power_schedule\`
           (\`id\`, \`enabled\`, \`suspendTime\`, \`wakeTime\`, \`recipients\`)
         VALUES (?, 1, '21:30', '06:00', ?)`,
        [randomUUID(), recipients],
      );
    }

    if (!(await this.tableExists(qr, 'server_power_day'))) {
      await qr.query(`
        CREATE TABLE \`server_power_day\` (
          \`id\` varchar(36) NOT NULL,
          \`dayOfWeek\` tinyint NOT NULL,
          \`active\` tinyint(1) NOT NULL DEFAULT 1,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`UQ_server_power_day_dow\` (\`dayOfWeek\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    const dayCount = await qr.query(`SELECT COUNT(*) AS c FROM \`server_power_day\``);
    if (Number(dayCount[0].c) === 0) {
      for (let dow = 1; dow <= 7; dow++) {
        await qr.query(
          `INSERT INTO \`server_power_day\` (\`id\`, \`dayOfWeek\`, \`active\`) VALUES (?, ?, ?)`,
          [randomUUID(), dow, dow <= 6 ? 1 : 0],
        );
      }
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS \`server_power_day\``);
    await qr.query(`DROP TABLE IF EXISTS \`server_power_schedule\``);
  }
}
```

- [ ] **Step 5: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores en los archivos nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/entities/server-power-schedule.entity.ts src/entities/server-power-day.entity.ts src/entities/index.ts src/database/migrations/1786000000073-CreateServerPowerSchedule.ts
git commit -m "feat(server-power): entidades + migracion 073 (schedule + una fila por dia)"
```

---

## Task 2: Util puro (validación / OnCalendar / next-event / desired.json)

**Files:**
- Create: `src/server-stats/power/power-schedule.util.ts`
- Test: `src/server-stats/power/power-schedule.util.spec.ts`

**Interfaces:**
- Produces:
  - `TIME_RE: RegExp`
  - `isValidTime(s: string): boolean`
  - `normalizeDays(days: number[]): number[]` (únicos, ordenados 1..7; lanza `Error` si inválido)
  - `daysToOnCalendar(days: number[], time: string): string`
  - `nextOccurrence(now: Date, days: number[], time: string): Date | null`
  - `computeNextEvents(now, days, suspendTime, wakeTime, enabled): { nextSuspend: Date | null; nextWake: Date | null }`
  - `buildDesired(input: { enabled: boolean; suspendTime: string; wakeTime: string; days: number[] }): { enabled: boolean; suspendTime: string; wakeTime: string; days: number[] }`

- [ ] **Step 1: Escribir el test que falla**

```ts
import {
  isValidTime,
  normalizeDays,
  daysToOnCalendar,
  nextOccurrence,
  computeNextEvents,
  buildDesired,
} from './power-schedule.util';

describe('power-schedule.util', () => {
  it('valida HH:MM', () => {
    expect(isValidTime('21:30')).toBe(true);
    expect(isValidTime('06:00')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
    expect(isValidTime('21:60')).toBe(false);
  });

  it('normaliza días: únicos, ordenados, rango 1..7', () => {
    expect(normalizeDays([6, 1, 1, 3])).toEqual([1, 3, 6]);
    expect(() => normalizeDays([])).toThrow();
    expect(() => normalizeDays([0])).toThrow();
    expect(() => normalizeDays([8])).toThrow();
  });

  it('arma OnCalendar de systemd', () => {
    expect(daysToOnCalendar([1, 2, 3, 4, 5, 6], '21:30')).toBe(
      'Mon,Tue,Wed,Thu,Fri,Sat *-*-* 21:30:00',
    );
    expect(daysToOnCalendar([7], '06:00')).toBe('Sun *-*-* 06:00:00');
  });

  it('nextOccurrence encuentra el próximo día activo a esa hora (TZ=UTC en tests)', () => {
    // 2026-09-18 es viernes (ISO 5). 08:00.
    const now = new Date('2026-09-18T08:00:00.000Z');
    // suspender viernes 21:30 -> mismo día
    expect(nextOccurrence(now, [1, 2, 3, 4, 5, 6], '21:30')?.toISOString()).toBe(
      '2026-09-18T21:30:00.000Z',
    );
    // si hoy (vie) no está activo, salta al lunes
    expect(nextOccurrence(now, [1], '21:30')?.toISOString()).toBe(
      '2026-09-21T21:30:00.000Z',
    );
  });

  it('computeNextEvents: wake es la mañana siguiente al próximo suspend', () => {
    const now = new Date('2026-09-18T08:00:00.000Z');
    const { nextSuspend, nextWake } = computeNextEvents(
      now,
      [1, 2, 3, 4, 5, 6],
      '21:30',
      '06:00',
      true,
    );
    expect(nextSuspend?.toISOString()).toBe('2026-09-18T21:30:00.000Z');
    expect(nextWake?.toISOString()).toBe('2026-09-19T06:00:00.000Z');
  });

  it('computeNextEvents: deshabilitado => null', () => {
    const now = new Date('2026-09-18T08:00:00.000Z');
    expect(computeNextEvents(now, [1], '21:30', '06:00', false)).toEqual({
      nextSuspend: null,
      nextWake: null,
    });
  });

  it('buildDesired normaliza días', () => {
    expect(
      buildDesired({ enabled: true, suspendTime: '21:30', wakeTime: '06:00', days: [6, 1, 1] }),
    ).toEqual({ enabled: true, suspendTime: '21:30', wakeTime: '06:00', days: [1, 6] });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/server-stats/power/power-schedule.util.spec.ts`
Expected: FAIL ("Cannot find module './power-schedule.util'").

- [ ] **Step 3: Implementar `power-schedule.util.ts`**

```ts
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(s: string): boolean {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function normalizeDays(days: number[]): number[] {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error('days: se requiere al menos un día');
  }
  const set = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw new Error(`days: valor inválido ${d} (esperado 1..7)`);
    }
    set.add(d);
  }
  return [...set].sort((a, b) => a - b);
}

const ISO_TO_SYSTEMD: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function daysToOnCalendar(days: number[], time: string): string {
  if (!isValidTime(time)) throw new Error(`time inválido: ${time}`);
  const tokens = normalizeDays(days).map((d) => ISO_TO_SYSTEMD[d]);
  return `${tokens.join(',')} *-*-* ${time}:00`;
}

/** JS getDay: 0=Dom..6=Sáb -> ISO 1=Lun..7=Dom. */
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

export function nextOccurrence(now: Date, days: number[], time: string): Date | null {
  const norm = normalizeDays(days);
  if (!isValidTime(time)) return null;
  const [h, m] = time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (norm.includes(isoWeekday(d)) && d.getTime() >= now.getTime()) return d;
  }
  return null;
}

export function computeNextEvents(
  now: Date,
  days: number[],
  suspendTime: string,
  wakeTime: string,
  enabled: boolean,
): { nextSuspend: Date | null; nextWake: Date | null } {
  if (!enabled) return { nextSuspend: null, nextWake: null };
  const nextSuspend = nextOccurrence(now, days, suspendTime);
  let nextWake: Date | null = null;
  if (nextSuspend && isValidTime(wakeTime)) {
    const [wh, wm] = wakeTime.split(':').map(Number);
    nextWake = new Date(nextSuspend);
    nextWake.setDate(nextWake.getDate() + 1);
    nextWake.setHours(wh, wm, 0, 0);
  }
  return { nextSuspend, nextWake };
}

export function buildDesired(input: {
  enabled: boolean;
  suspendTime: string;
  wakeTime: string;
  days: number[];
}): { enabled: boolean; suspendTime: string; wakeTime: string; days: number[] } {
  if (!isValidTime(input.suspendTime)) throw new Error(`suspendTime inválido: ${input.suspendTime}`);
  if (!isValidTime(input.wakeTime)) throw new Error(`wakeTime inválido: ${input.wakeTime}`);
  return {
    enabled: !!input.enabled,
    suspendTime: input.suspendTime,
    wakeTime: input.wakeTime,
    days: normalizeDays(input.days),
  };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/server-stats/power/power-schedule.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-stats/power/power-schedule.util.ts src/server-stats/power/power-schedule.util.spec.ts
git commit -m "feat(server-power): util puro (validacion, OnCalendar, next-event, desired)"
```

---

## Task 3: DTO + PowerSecretGuard

**Files:**
- Create: `src/server-stats/power/dto/update-power-schedule.dto.ts`
- Create: `src/server-stats/power/power-secret.guard.ts`

**Interfaces:**
- Produces: `UpdatePowerScheduleDto { enabled, suspendTime, wakeTime, days, recipients }`; `PowerSecretGuard` (header `X-Power-Secret` vs `POWER_SECRET`, fail-closed).

- [ ] **Step 1: Crear `dto/update-power-schedule.dto.ts`**

```ts
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TIME_RE } from '../power-schedule.util';

export class UpdatePowerScheduleDto {
  @IsBoolean()
  enabled: boolean;

  @Matches(TIME_RE, { message: 'suspendTime debe ser HH:MM (00:00–23:59)' })
  suspendTime: string;

  @Matches(TIME_RE, { message: 'wakeTime debe ser HH:MM (00:00–23:59)' })
  wakeTime: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days: number[];

  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  recipients: string[];
}
```

- [ ] **Step 2: Crear `power-secret.guard.ts`** (copia el patrón de `backup-secret.guard.ts`)

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Autoriza el endpoint interno `/server/power/internal/notify` (lo llaman los hooks
 * de systemd-sleep en localhost) comparando `X-Power-Secret` contra `POWER_SECRET`.
 * Fail-closed: si `POWER_SECRET` no está configurado, NADIE pasa.
 */
@Injectable()
export class PowerSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const expected = this.config.get<string>('POWER_SECRET') || process.env.POWER_SECRET;
    if (!expected) return false;
    const req = context.switchToHttp().getRequest();
    const provided = (req.headers?.['x-power-secret'] || '').toString();
    return this.safeEqual(provided, expected);
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
```

- [ ] **Step 3: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/server-stats/power/dto/update-power-schedule.dto.ts src/server-stats/power/power-secret.guard.ts
git commit -m "feat(server-power): DTO validado + guard por secreto"
```

---

## Task 4: PowerApplyRunner (wrapper de I/O)

**Files:**
- Create: `src/server-stats/power/power-apply.runner.ts`

**Interfaces:**
- Produces: `PowerApplyRunner` con:
  - `writeDesired(desired: object): Promise<void>` (escribe `POWER_DESIRED_PATH`)
  - `apply(): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }>` (spawn `sudo POWER_APPLY_BIN`)
  - `isTimerActive(): Promise<boolean>` (spawn `systemctl is-active pmy-power-suspend.timer`)

- [ ] **Step 1: Crear `power-apply.runner.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import { dirname } from 'path';

const DESIRED_PATH = process.env.POWER_DESIRED_PATH || '/var/lib/pmy-power/desired.json';
const APPLY_BIN = process.env.POWER_APPLY_BIN || '/usr/local/sbin/pmy-power-apply';

@Injectable()
export class PowerApplyRunner {
  async writeDesired(desired: object): Promise<void> {
    await fsp.mkdir(dirname(DESIRED_PATH), { recursive: true }).catch(() => undefined);
    await fsp.writeFile(DESIRED_PATH, JSON.stringify(desired, null, 2), 'utf8');
  }

  apply(): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    return this.run('sudo', ['-n', APPLY_BIN]);
  }

  async isTimerActive(): Promise<boolean> {
    const r = await this.run('systemctl', ['is-active', 'pmy-power-suspend.timer']);
    return r.stdout.trim() === 'active';
  }

  private run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(cmd, args);
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (e) => resolve({ ok: false, stdout, stderr: stderr + String(e), code: -1 }));
      child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr, code: code ?? -1 }));
    });
  }
}
```

- [ ] **Step 2: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/server-stats/power/power-apply.runner.ts
git commit -m "feat(server-power): PowerApplyRunner (write desired + sudo apply + timer status)"
```

---

## Task 5: ServerPowerService (orquestación) + tests

**Files:**
- Create: `src/server-stats/power/server-power.service.ts`
- Test: `src/server-stats/power/server-power.service.spec.ts`

**Interfaces:**
- Consumes: `ServerPowerSchedule`, `ServerPowerDay` (Task 1), util (Task 2), `PowerApplyRunner` (Task 4), `MailService`, `ConfigService`.
- Produces:
  - `get(): Promise<PowerScheduleView>` donde `PowerScheduleView = { enabled, suspendTime, wakeTime, days: number[], recipients: string[], status: { nextSuspend: string | null; nextWake: string | null; timerActive: boolean; lastAppliedAt: string | null; lastApplyError: string | null } }`
  - `update(dto: UpdatePowerScheduleDto, userId?: string): Promise<PowerScheduleView>`
  - `notify(event: 'suspend' | 'wake'): Promise<void>`
  - `sendTestEmail(): Promise<void>`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerPowerService } from './server-power.service';
import { ServerPowerSchedule } from '../../entities/server-power-schedule.entity';
import { ServerPowerDay } from '../../entities/server-power-day.entity';
import { PowerApplyRunner } from './power-apply.runner';
import { MailService } from '../../mail/mail.service';
import { ConfigService } from '@nestjs/config';

function makeSchedRepo(row: any) {
  return {
    findOne: jest.fn().mockResolvedValue(row),
    save: jest.fn().mockImplementation(async (r) => ({ ...row, ...r })),
    create: jest.fn().mockImplementation((r) => r),
  };
}
function makeDayRepo(rows: any[]) {
  return {
    find: jest.fn().mockResolvedValue(rows),
    save: jest.fn().mockImplementation(async (r) => r),
  };
}

const baseRow = {
  id: 'sched-1',
  enabled: true,
  suspendTime: '21:30',
  wakeTime: '06:00',
  recipients: ['a@x.com'],
  lastAppliedAt: null,
  lastApplyError: null,
};
const baseDays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ id: `d${d}`, dayOfWeek: d, active: d <= 6 }));

async function build(overrides: {
  sched?: any;
  days?: any[];
  runner?: Partial<PowerApplyRunner>;
  mail?: Partial<MailService>;
}) {
  const runner = {
    writeDesired: jest.fn().mockResolvedValue(undefined),
    apply: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '', code: 0 }),
    isTimerActive: jest.fn().mockResolvedValue(true),
    ...(overrides.runner || {}),
  };
  const mail = { sendEmailNotification: jest.fn().mockResolvedValue(undefined), ...(overrides.mail || {}) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ServerPowerService,
      { provide: getRepositoryToken(ServerPowerSchedule), useValue: makeSchedRepo(overrides.sched ?? baseRow) },
      { provide: getRepositoryToken(ServerPowerDay), useValue: makeDayRepo(overrides.days ?? baseDays) },
      { provide: PowerApplyRunner, useValue: runner },
      { provide: MailService, useValue: mail },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  }).compile();
  return { svc: moduleRef.get(ServerPowerService), runner, mail };
}

describe('ServerPowerService', () => {
  it('get() devuelve la config con días activos y status', async () => {
    const { svc } = await build({});
    const view = await svc.get();
    expect(view.suspendTime).toBe('21:30');
    expect(view.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(view.recipients).toEqual(['a@x.com']);
    expect(view.status.timerActive).toBe(true);
  });

  it('update() persiste, escribe desired y aplica (ok)', async () => {
    const { svc, runner } = await build({});
    const view = await svc.update(
      { enabled: true, suspendTime: '22:00', wakeTime: '06:30', days: [1, 3, 5], recipients: ['b@x.com'] },
      'user-9',
    );
    expect(runner.writeDesired).toHaveBeenCalledWith(
      expect.objectContaining({ suspendTime: '22:00', wakeTime: '06:30', days: [1, 3, 5], enabled: true }),
    );
    expect(runner.apply).toHaveBeenCalled();
    expect(view.status.lastApplyError).toBeNull();
  });

  it('update() propaga error de apply (guarda lastApplyError y lanza)', async () => {
    const { svc } = await build({
      runner: { apply: jest.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'boom', code: 1 }) },
    });
    await expect(
      svc.update(
        { enabled: true, suspendTime: '22:00', wakeTime: '06:30', days: [1], recipients: ['b@x.com'] },
        'user-9',
      ),
    ).rejects.toThrow(/boom/);
  });

  it('notify() manda correo a los recipients de BD', async () => {
    const { svc, mail } = await build({});
    await svc.notify('suspend');
    expect(mail.sendEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@x.com'] }),
    );
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/server-stats/power/server-power.service.spec.ts`
Expected: FAIL ("Cannot find module './server-power.service'").

- [ ] **Step 3: Implementar `server-power.service.ts`**

```ts
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { ServerPowerSchedule } from '../../entities/server-power-schedule.entity';
import { ServerPowerDay } from '../../entities/server-power-day.entity';
import { MailService } from '../../mail/mail.service';
import { PowerApplyRunner } from './power-apply.runner';
import { UpdatePowerScheduleDto } from './dto/update-power-schedule.dto';
import { buildDesired, computeNextEvents, normalizeDays } from './power-schedule.util';

export interface PowerScheduleView {
  enabled: boolean;
  suspendTime: string;
  wakeTime: string;
  days: number[];
  recipients: string[];
  status: {
    nextSuspend: string | null;
    nextWake: string | null;
    timerActive: boolean;
    lastAppliedAt: string | null;
    lastApplyError: string | null;
  };
}

@Injectable()
export class ServerPowerService {
  private readonly logger = new Logger(ServerPowerService.name);

  constructor(
    @InjectRepository(ServerPowerSchedule) private readonly schedRepo: Repository<ServerPowerSchedule>,
    @InjectRepository(ServerPowerDay) private readonly dayRepo: Repository<ServerPowerDay>,
    private readonly runner: PowerApplyRunner,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private async getRow(): Promise<ServerPowerSchedule> {
    let row = await this.schedRepo.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!row) row = await this.schedRepo.save(this.schedRepo.create({}));
    return row;
  }

  private async activeDays(): Promise<number[]> {
    const rows = await this.dayRepo.find();
    return normalizeDays(rows.filter((r) => r.active).map((r) => r.dayOfWeek));
  }

  async get(): Promise<PowerScheduleView> {
    const row = await this.getRow();
    let days: number[] = [];
    try {
      days = await this.activeDays();
    } catch {
      days = [];
    }
    const { nextSuspend, nextWake } = computeNextEvents(
      new Date(),
      days,
      row.suspendTime,
      row.wakeTime,
      row.enabled,
    );
    const timerActive = await this.runner.isTimerActive().catch(() => false);
    return {
      enabled: row.enabled,
      suspendTime: row.suspendTime,
      wakeTime: row.wakeTime,
      days,
      recipients: row.recipients ?? [],
      status: {
        nextSuspend: nextSuspend ? nextSuspend.toISOString() : null,
        nextWake: nextWake ? nextWake.toISOString() : null,
        timerActive,
        lastAppliedAt: row.lastAppliedAt ? row.lastAppliedAt.toISOString() : null,
        lastApplyError: row.lastApplyError ?? null,
      },
    };
  }

  async update(dto: UpdatePowerScheduleDto, userId?: string): Promise<PowerScheduleView> {
    const days = normalizeDays(dto.days);

    const row = await this.getRow();
    row.enabled = dto.enabled;
    row.suspendTime = dto.suspendTime;
    row.wakeTime = dto.wakeTime;
    row.recipients = dto.recipients;
    row.updatedById = userId ?? null;
    await this.schedRepo.save(row);

    const dayRows = await this.dayRepo.find();
    for (const dr of dayRows) {
      const shouldBeActive = days.includes(dr.dayOfWeek);
      if (dr.active !== shouldBeActive) {
        dr.active = shouldBeActive;
        await this.dayRepo.save(dr);
      }
    }

    const desired = buildDesired({
      enabled: dto.enabled,
      suspendTime: dto.suspendTime,
      wakeTime: dto.wakeTime,
      days,
    });
    await this.runner.writeDesired(desired);
    const result = await this.runner.apply();

    if (!result.ok) {
      const msg = (result.stderr || result.stdout || `exit ${result.code}`).trim();
      row.lastApplyError = msg;
      await this.schedRepo.save(row);
      this.logger.error(`pmy-power-apply falló: ${msg}`);
      throw new InternalServerErrorException(`No se pudo aplicar el horario al servidor: ${msg}`);
    }

    row.lastApplyError = null;
    row.lastAppliedAt = new Date();
    await this.schedRepo.save(row);

    return this.get();
  }

  async notify(event: 'suspend' | 'wake'): Promise<void> {
    const row = await this.getRow();
    const recipients = row.recipients ?? [];
    if (!recipients.length) {
      this.logger.warn(`notify(${event}) sin destinatarios; no se envía correo`);
      return;
    }
    const host = os.hostname();
    const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' });
    const isSuspend = event === 'suspend';
    const subject = isSuspend
      ? `🌙 Servidor ${host} se está suspendiendo`
      : `☀️ Servidor ${host} despertó`;
    const htmlContent = isSuspend
      ? `<p>El servidor <b>${host}</b> se va a suspender.</p><p>Hora: ${now}</p><p>Despertará automáticamente a las <b>${row.wakeTime}</b>.</p>`
      : `<p>El servidor <b>${host}</b> despertó y está en línea.</p><p>Hora: ${now}</p>`;
    await this.mail.sendEmailNotification({ to: recipients, subject, htmlContent });
  }

  async sendTestEmail(): Promise<void> {
    const row = await this.getRow();
    const recipients = row.recipients ?? [];
    if (!recipients.length) throw new InternalServerErrorException('No hay destinatarios configurados');
    await this.mail.sendEmailNotification({
      to: recipients,
      subject: `✅ Prueba de alerta de energía — ${os.hostname()}`,
      htmlContent: `<p>Correo de prueba de Configuración → Servidor. Si lo recibes, las alertas de suspensión/despertar funcionan.</p>`,
    });
  }
}
```

> Nota de tipos: `sendEmailNotification` (en `src/mail/mail.service.ts:429`) recibe `SendEmailOptions { to, subject, htmlContent, cc?, attachments? }`. Si el linter marca el import del tipo, no es necesario importarlo: el objeto literal cumple la forma.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/server-stats/power/server-power.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server-stats/power/server-power.service.ts src/server-stats/power/server-power.service.spec.ts
git commit -m "feat(server-power): ServerPowerService (get/update/notify/test) + tests"
```

---

## Task 6: Controller + wiring del módulo

**Files:**
- Create: `src/server-stats/power/server-power.controller.ts`
- Modify: `src/server-stats/server-stats.module.ts`

**Interfaces:**
- Consumes: `ServerPowerService` (Task 5), `SuperAdminGuard`, `PowerSecretGuard` (Task 3), `Public`, `NoAudit`.
- Produces: rutas `GET/PUT /server/power/schedule`, `POST /server/power/test-email`, `POST /server/power/internal/notify`.

- [ ] **Step 1: Crear `server-power.controller.ts`**

```ts
import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../../audit/super-admin.guard';
import { NoAudit } from '../../audit/audit.decorator';
import { Public } from '../../auth/decorators/decorators/public-decorator';
import { ServerPowerService } from './server-power.service';
import { UpdatePowerScheduleDto } from './dto/update-power-schedule.dto';
import { PowerSecretGuard } from './power-secret.guard';

@ApiTags('server')
@ApiBearerAuth()
@Controller('server/power')
export class ServerPowerController {
  constructor(private readonly svc: ServerPowerService) {}

  /** Horario actual + estado — solo superadmin. */
  @Get('schedule')
  @UseGuards(SuperAdminGuard)
  get() {
    return this.svc.get();
  }

  /** Guarda horario/días/destinatarios y lo aplica al SO — solo superadmin. */
  @Put('schedule')
  @UseGuards(SuperAdminGuard)
  update(@Body() dto: UpdatePowerScheduleDto, @Req() req: any) {
    return this.svc.update(dto, req.user?.id);
  }

  /** Correo de prueba — solo superadmin. */
  @Post('test-email')
  @UseGuards(SuperAdminGuard)
  async testEmail() {
    await this.svc.sendTestEmail();
    return { ok: true };
  }

  /** Lo llaman los hooks de systemd-sleep en localhost (secreto compartido). */
  @Post('internal/notify')
  @Public()
  @NoAudit()
  @UseGuards(PowerSecretGuard)
  async notify(@Body() body: { event: 'suspend' | 'wake' }) {
    const event = body?.event === 'wake' ? 'wake' : 'suspend';
    await this.svc.notify(event);
    return { ok: true };
  }
}
```

- [ ] **Step 2: Modificar `server-stats.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';
import { ServerLogsService } from './server-logs.service';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { ServerPowerSchedule } from '../entities/server-power-schedule.entity';
import { ServerPowerDay } from '../entities/server-power-day.entity';
import { MailModule } from '../mail/mail.module';
import { ServerPowerController } from './power/server-power.controller';
import { ServerPowerService } from './power/server-power.service';
import { PowerApplyRunner } from './power/power-apply.runner';
import { PowerSecretGuard } from './power/power-secret.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ServerPowerSchedule, ServerPowerDay]), MailModule],
  controllers: [ServerStatsController, BackupController, ServerPowerController],
  providers: [
    ServerStatsService,
    ServerLogsService,
    BackupService,
    ServerPowerService,
    PowerApplyRunner,
    PowerSecretGuard,
  ],
})
export class ServerStatsModule {}
```

- [ ] **Step 3: Compilar + correr tests del módulo**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest src/server-stats/power`
Expected: compila y PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server-stats/power/server-power.controller.ts src/server-stats/server-stats.module.ts
git commit -m "feat(server-power): endpoints /server/power/* + wiring del modulo"
```

---

## Task 7: Provisioning del SO (systemd + rtcwake + sudoers + hooks)

**Files:**
- Create: `deploy/setup-power-schedule.sh`
- Create: `deploy/README-power-schedule.md`

**Interfaces:**
- Consumes: `desired.json` que escribe `PowerApplyRunner` (Task 4); endpoint `POST /server/power/internal/notify` (Task 6).
- Produces (en el SO): `/usr/local/sbin/pmy-power-apply`, `/usr/local/sbin/pmy-power-suspend`, `/usr/lib/systemd/system-sleep/pmy-power`, `pmy-power-suspend.{service,timer}`, `/etc/sudoers.d/pmy-power`, dirs `/etc/pmy-power` y `/var/lib/pmy-power`.

- [ ] **Step 1: Crear `deploy/setup-power-schedule.sh`**

```bash
#!/usr/bin/env bash
# Instala la suspensión/despertar programado del servidor (idempotente).
# Uso:
#   APP_USER=pmy APP_PORT=3000 sudo -E bash deploy/setup-power-schedule.sh
# Variables:
#   APP_USER   usuario que corre pmy-api (pm2). Default: SUDO_USER.
#   APP_PORT   puerto HTTP del backend para el hook de correo. Default: 3000.
#   POWER_SECRET  secreto compartido; si no se pasa, se genera y se persiste.
set -euo pipefail

APP_USER="${APP_USER:-${SUDO_USER:-}}"
APP_PORT="${APP_PORT:-3000}"
[ -n "$APP_USER" ] || { echo "APP_USER requerido"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Corre con sudo"; exit 1; }

POWER_SECRET="${POWER_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)}"

install -d -m 0755 /etc/pmy-power
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" /var/lib/pmy-power

# Config del hook (secreto + puerto) — root, legible por el hook (root).
cat > /etc/pmy-power/notify.env <<EOF
POWER_SECRET=${POWER_SECRET}
APP_PORT=${APP_PORT}
EOF
chmod 0600 /etc/pmy-power/notify.env

# schedule.env inicial (lo reescribe pmy-power-apply).
[ -f /etc/pmy-power/schedule.env ] || cat > /etc/pmy-power/schedule.env <<'EOF'
ENABLED=1
SUSPEND_TIME=21:30
WAKE_TIME=06:00
DAYS=Mon,Tue,Wed,Thu,Fri,Sat
EOF

# ---- pmy-power-apply: lee desired.json, valida, reescribe unidad + schedule.env ----
cat > /usr/local/sbin/pmy-power-apply <<'APPLY'
#!/usr/bin/env bash
set -euo pipefail
DESIRED=/var/lib/pmy-power/desired.json
[ -f "$DESIRED" ] || { echo "no existe $DESIRED" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq no instalado" >&2; exit 1; }

ENABLED=$(jq -r '.enabled' "$DESIRED")
SUSPEND=$(jq -r '.suspendTime' "$DESIRED")
WAKE=$(jq -r '.wakeTime' "$DESIRED")
mapfile -t DAYS < <(jq -r '.days[]' "$DESIRED")

# Validación estricta (anti-inyección en unit files).
[[ "$SUSPEND" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "suspendTime inválido: $SUSPEND" >&2; exit 2; }
[[ "$WAKE"    =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "wakeTime inválido: $WAKE" >&2; exit 2; }
declare -A MAP=( [1]=Mon [2]=Tue [3]=Wed [4]=Thu [5]=Fri [6]=Sat [7]=Sun )
TOKENS=()
for d in "${DAYS[@]}"; do
  [[ "$d" =~ ^[1-7]$ ]] || { echo "día inválido: $d" >&2; exit 2; }
  TOKENS+=("${MAP[$d]}")
done
[ "${#TOKENS[@]}" -gt 0 ] || { echo "sin días" >&2; exit 2; }
DAYSTR=$(IFS=,; echo "${TOKENS[*]}")

cat > /etc/pmy-power/schedule.env <<EOF
ENABLED=${ENABLED}
SUSPEND_TIME=${SUSPEND}
WAKE_TIME=${WAKE}
DAYS=${DAYSTR}
EOF

# Drop-in con el OnCalendar calculado.
install -d -m 0755 /etc/systemd/system/pmy-power-suspend.timer.d
cat > /etc/systemd/system/pmy-power-suspend.timer.d/schedule.conf <<EOF
[Timer]
OnCalendar=
OnCalendar=${DAYSTR} *-*-* ${SUSPEND}:00
EOF

systemctl daemon-reload
if [ "$ENABLED" = "true" ] || [ "$ENABLED" = "1" ]; then
  systemctl enable --now pmy-power-suspend.timer
else
  systemctl disable --now pmy-power-suspend.timer || true
fi
echo "aplicado: ${DAYSTR} ${SUSPEND} (wake ${WAKE}, enabled=${ENABLED})"
APPLY
chmod 0755 /usr/local/sbin/pmy-power-apply

# ---- pmy-power-suspend: arma RTC y suspende (por vía systemd, para disparar hooks) ----
cat > /usr/local/sbin/pmy-power-suspend <<'SUSP'
#!/usr/bin/env bash
set -euo pipefail
source /etc/pmy-power/schedule.env
[ "${ENABLED:-1}" = "1" ] || { echo "deshabilitado; no suspende"; exit 0; }
[ -e /sys/class/rtc/rtc0 ] || { echo "sin RTC (/sys/class/rtc/rtc0); NO se suspende" >&2; exit 1; }

# Próxima ocurrencia de WAKE_TIME (hoy si aún no pasa, si no mañana).
WAKE_EPOCH=$(date -d "today ${WAKE_TIME}" +%s)
[ "$WAKE_EPOCH" -le "$(date +%s)" ] && WAKE_EPOCH=$(date -d "tomorrow ${WAKE_TIME}" +%s)

# -m no: SOLO arma la alarma del RTC (no suspende). Si falla, abortar.
if ! rtcwake -m no -t "$WAKE_EPOCH"; then
  echo "no se pudo armar la alarma RTC; NO se suspende" >&2
  exit 1
fi
# Suspende por systemd (dispara /usr/lib/systemd/system-sleep/*).
systemctl suspend
SUSP
chmod 0755 /usr/local/sbin/pmy-power-suspend

# ---- hook de sleep: correos pre (suspend) / post (wake) ----
cat > /usr/lib/systemd/system-sleep/pmy-power <<'HOOK'
#!/usr/bin/env bash
# $1 = pre|post ; $2 = suspend|hibernate|...
set -euo pipefail
[ -f /etc/pmy-power/notify.env ] || exit 0
source /etc/pmy-power/notify.env
URL="http://127.0.0.1:${APP_PORT}/server/power/internal/notify"

notify() {
  local event="$1"
  curl -fsS -m 15 -X POST "$URL" \
    -H "X-Power-Secret: ${POWER_SECRET}" \
    -H 'Content-Type: application/json' \
    -d "{\"event\":\"${event}\"}" >/dev/null 2>&1 || true
}

case "$1" in
  pre)  notify suspend ;;
  post)
    # Espera breve a que regrese la red tras el resume, luego avisa.
    for i in $(seq 1 10); do
      curl -fsS -m 3 "http://127.0.0.1:${APP_PORT}" >/dev/null 2>&1 && break
      sleep 2
    done
    notify wake
    ;;
esac
HOOK
chmod 0755 /usr/lib/systemd/system-sleep/pmy-power

# ---- unidades systemd ----
cat > /etc/systemd/system/pmy-power-suspend.service <<'UNIT'
[Unit]
Description=PMY suspend programado (arma RTC + suspend)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pmy-power-suspend
UNIT

cat > /etc/systemd/system/pmy-power-suspend.timer <<'UNIT'
[Unit]
Description=PMY timer de suspensión programada
[Timer]
OnCalendar=Mon,Tue,Wed,Thu,Fri,Sat *-*-* 21:30:00
Persistent=false
[Install]
WantedBy=timers.target
UNIT

# ---- sudoers acotado: la app solo puede correr pmy-power-apply ----
cat > /etc/sudoers.d/pmy-power <<EOF
${APP_USER} ALL=(root) NOPASSWD: /usr/local/sbin/pmy-power-apply
EOF
chmod 0440 /etc/sudoers.d/pmy-power
visudo -cf /etc/sudoers.d/pmy-power

# ---- inyecta POWER_SECRET / POWER_NOTIFY_PORT en el .env de la app si falta ----
APP_ENV="${BACKEND_ENV:-/opt/pmy-api/.env}"
if [ -f "$APP_ENV" ]; then
  grep -q '^POWER_SECRET=' "$APP_ENV" || echo "POWER_SECRET=${POWER_SECRET}" >> "$APP_ENV"
  grep -q '^POWER_NOTIFY_PORT=' "$APP_ENV" || echo "POWER_NOTIFY_PORT=${APP_PORT}" >> "$APP_ENV"
  echo "→ Revisa $APP_ENV (POWER_SECRET/POWER_NOTIFY_PORT) y reinicia: pm2 restart pmy-api"
else
  echo "⚠ No encontré $APP_ENV. Agrega manualmente: POWER_SECRET=${POWER_SECRET}"
fi

systemctl daemon-reload
echo "OK. Instalado. jq requerido (apt-get install -y jq si falta)."
```

- [ ] **Step 2: Crear `deploy/README-power-schedule.md`**

```markdown
# Suspensión/Despertar programado del servidor

Instala systemd + rtcwake para suspender el servidor (default 21:30, L–S) y
despertarlo (default 06:00), con alertas por correo. Los horarios se editan
desde la app en **Configuración → Servidor** (solo superadmin).

## Requisitos
- Máquina física con RTC (`ls /sys/class/rtc/rtc0`).
- `jq` instalado: `sudo apt-get install -y jq`.

## Instalar (una vez)
\`\`\`bash
APP_USER=<usuario_pm2> APP_PORT=3000 BACKEND_ENV=/opt/pmy-api/.env \
  sudo -E bash deploy/setup-power-schedule.sh
\`\`\`
Luego revisa `POWER_SECRET`/`POWER_NOTIFY_PORT` en el `.env` y `pm2 restart pmy-api`.

## Probar el despertar por RTC (sin esperar a la noche)
\`\`\`bash
sudo rtcwake -m no -t $(date -d '+2 min' +%s) && sudo systemctl suspend
\`\`\`
Debe despertar solo en ~2 min y llegar los correos de suspend/wake.

## Verificar
- `systemctl status pmy-power-suspend.timer`
- `systemctl list-timers | grep pmy-power`
- `journalctl -u pmy-power-suspend.service -e`
```

- [ ] **Step 3: Verificar sintaxis bash**

Run: `bash -n deploy/setup-power-schedule.sh`
Expected: sin errores de sintaxis.

- [ ] **Step 4: Commit**

```bash
git add deploy/setup-power-schedule.sh deploy/README-power-schedule.md
git commit -m "feat(server-power): provisioning SO (systemd timer + rtcwake + hooks + sudoers)"
```

---

## Task 8: Verificación final

- [ ] **Step 1: Suite completa del feature + typecheck**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest src/server-stats/power`
Expected: compila y todos los tests del feature PASAN.

- [ ] **Step 2: Correr la migración en dev (si hay BD dev disponible)**

Run: `npm run migration:run` (o el script de migraciones del repo)
Expected: crea `server_power_schedule` (1 fila) y `server_power_day` (7 filas).
> Si no hay BD dev a la mano, se valida al desplegar; el resto del feature no depende de correrla localmente.

- [ ] **Step 3: (Opcional) invocar requesting-code-review antes de integrar.**

---

## Self-Review (cobertura del spec)

- §3 mecanismo `rtcwake -m no` + `systemctl suspend` + salvaguarda RTC → Task 7 (`pmy-power-suspend`). ✔
- §5.1 entidad settings → Task 1. ✔
- §5.2 una fila por día → Task 1 (entidad + seed 7 filas). ✔
- §5.3 migración 073 → Task 1. ✔
- §6.1 endpoints (GET/PUT/test-email/internal notify) → Task 6. ✔
- §6.2 validación DTO + mapeo a filas de día → Task 3 (DTO) + Task 5 (mapeo). ✔
- §6.3 desired.json desde días activos → Task 5 (`buildDesired` + `activeDays`). ✔
- §6.4 correos vía MailService → Task 5 (`notify`/`sendTestEmail`). ✔
- §7 provisioning (scripts, unidades, sudoers, hooks) → Task 7. ✔
- §9 manejo de errores (apply falla → 500 + lastApplyError; no suspender sin RTC) → Task 5 + Task 7. ✔
- §10 pruebas (validación, desired, notify, apply-error) → Task 2 + Task 5. ✔

## Fuera de este plan (repo app-pmy)

La pantalla **Configuración → Servidor** (switch, time pickers, checkboxes de días L–S,
lista editable de correos, botón Guardar solo-superadmin, estado próximo suspend/wake, botón
"Enviar correo de prueba", y botón **"Suspender ahora"** con confirmación doble) se implementa
en el repo `app-pmy` con su propio plan, respetando las house rules (AppLayout + withAuth +
OperationHeader, solo shadcn + Tailwind, lenguaje llano) y consumiendo
`GET/PUT /server/power/schedule`, `POST /server/power/test-email` y `POST /server/power/suspend-now`.
```
