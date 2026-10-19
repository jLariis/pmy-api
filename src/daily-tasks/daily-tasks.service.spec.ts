import 'dotenv/config';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { config } from '../config/config';
import { DailyTaskFactsService } from './daily-task-facts.service';
import { DailyTasksService, weekStartOf } from './daily-tasks.service';
import { DailyTask } from '../entities/daily-task.entity';
import { DailyLd } from '../entities/daily-ld.entity';
import { OpsAlertSubsidiary } from '../entities/ops-alert.entity';

describe('weekStartOf', () => {
  it('semana de lunes a domingo', () => {
    expect(weekStartOf('2026-10-17')).toBe('2026-10-12'); // sábado
    expect(weekStartOf('2026-10-18')).toBe('2026-10-12'); // domingo
    expect(weekStartOf('2026-10-12')).toBe('2026-10-12'); // lunes
  });
});

const run = process.env.DAILY_TASKS_DB_TEST === '1' ? describe : describe.skip;

/** BD local, en transacción revertida (TZ=UTC como el servidor: src/main.ts). */
run('DailyTasksService.week (BD local)', () => {
  let ds: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    ds = new DataSource({ ...(config().database as any), migrations: [], logging: false });
    await ds.initialize();
    qr = ds.createQueryRunner();
    await qr.startTransaction();
  });

  afterAll(async () => {
    await qr?.rollbackTransaction();
    await qr?.release();
    await ds?.destroy();
  });

  it('cada fila cae en su propio día (sin correrse un día por la zona horaria)', async () => {
    const sub = (await qr.query('SELECT id FROM subsidiary WHERE active = 1 LIMIT 1'))[0].id;
    const m = qr.manager;
    await qr.query("INSERT INTO daily_task (id, subsidiaryId, day, refType, refId, step, status, dueAt) VALUES (?, ?, '2031-03-05', 'subsidiary', ?, 'inventory_final', 'done', '2031-03-06 03:00:00')", [randomUUID(), sub, sub]);
    const ops: any = { getSettings: async () => ({ unloadingTime: '21:00', dispatchTime: '10:00', closureTime: '21:00', uploadMinutes: 30, activeTo: '21:30', completePct: 100 }) };
    const svc = new DailyTasksService(m.getRepository(DailyTask), m.getRepository(DailyLd), m.getRepository(OpsAlertSubsidiary), new DailyTaskFactsService(m as any), ops, m as any);
    const w = await svc.week(sub, '2031-03-03', new Date('2031-03-01T12:00:00Z')); // "hoy" antes de la semana: no recalcula
    expect(w.days.find((d) => d.day === '2031-03-05')!.total).toBe(1);
    expect(w.days.find((d) => d.day === '2031-03-04')!.total).toBe(0);
  });
});

describe('DailyTasksService.refreshDay (sin BD)', () => {
  const settings = { unloadingTime: '21:00', dispatchTime: '10:00', closureTime: '21:00', uploadMinutes: 30, activeTo: '21:30', completePct: 100 };
  const subFacts = { day: '2026-10-17', inventoryInitialAt: new Date('2026-10-17T15:00:00Z'), inventoryFinalAt: null, inventoryInitialBy: null, inventoryFinalBy: null, dispatchesTotal: 0, dispatchesClosed: 0, lastClosureAt: null, dexTotal: 0, dexWithDevolution: 0, lastDevolutionAt: null };
  const make = (over: any = {}) => {
    const saved: any[] = [];
    let calls = 0;
    const repo: any = {
      find: jest.fn(async () => (calls > 0 ? saved : [])),
      create: (x: any) => x,
      save: jest.fn(async (rows: any[]) => {
        calls++;
        if (over.dupOnce && calls === 1) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        saved.push(...rows);
        return rows;
      }),
      delete: jest.fn(),
    };
    const facts: any = { subsidiaryFacts: async () => ({ ...subFacts, ...(over.sub ?? {}) }), consolidatedFacts: async () => [] };
    const svc = new DailyTasksService(repo, {} as any, { findOne: async () => over.cfg ?? null } as any, facts, { getSettings: async () => settings } as any, {} as any);
    return { svc, repo, saved };
  };

  it('si otro proceso guardó la misma fila al mismo tiempo, reintenta en vez de fallar', async () => {
    const { svc, repo } = make({ dupOnce: true });
    await expect(svc.refreshDay('s1', '2026-10-17', new Date('2026-10-17T18:00:00Z'))).resolves.toBeDefined();
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('el interruptor de la sucursal no esconde el paso en pantalla', async () => {
    const { svc, saved } = make({ cfg: { stepInventoryInitial: false } });
    await svc.refreshDay('s1', '2026-10-17', new Date('2026-10-17T18:00:00Z'));
    expect(saved.map((r) => r.step)).toContain('inventory_initial');
  });

  it('sucursal sin operación ese día: sin tareas de sucursal', async () => {
    const { svc, saved } = make({ sub: { inventoryInitialAt: null } });
    await svc.refreshDay('s1', '2026-10-17', new Date('2026-10-17T18:00:00Z'));
    expect(saved).toEqual([]);
  });

  it('las filas nuevas guardan el estado ya avisado', async () => {
    const { svc, saved } = make();
    await svc.refreshDay('s1', '2026-10-17', new Date('2026-10-17T18:00:00Z'));
    expect(saved.find((r) => r.step === 'inventory_initial')).toMatchObject({ status: 'done', notifiedStatus: 'done' });
  });
});
