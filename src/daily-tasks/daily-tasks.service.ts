import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Not, Repository } from 'typeorm';
import { DailyTask } from '../entities/daily-task.entity';
import { DailyLd } from '../entities/daily-ld.entity';
import { OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { OpsAlertsService } from '../ops-alerts/ops-alerts.service';
import { addDays, localDay } from '../ops-alerts/ops-alerts.util';
import { DailyTaskFactsService } from './daily-task-facts.service';
import { diffTasks, taskKey, Transition } from './daily-task-diff.util';
import { resolveSchedule } from './daily-task-schedule.util';
import { consolidatedTasks, subsidiaryTasks } from './daily-task-steps.util';
import { Schedule, TaskRefType, TaskRow, TaskStep } from './daily-task.types';

export type DayTransition = Transition & { subsidiaryId: string; day: string };

/** Paso → interruptor por sucursal (`ops_alert_subsidiary`). El inventario final usa el de inventario de siempre. */
const STEP_FLAG: Record<TaskStep, keyof OpsAlertSubsidiary> = {
  upload: 'stepUpload',
  unloading: 'stepUnloading',
  dispatch: 'stepDispatch',
  closure: 'stepClosure',
  devolutions: 'stepDevolutions',
  inventory_initial: 'stepInventoryInitial',
  inventory_final: 'stepInventory',
};

/** Días que el cron recalcula cada 5 min: hoy y los 2 anteriores (los cierres y devoluciones llegan al día siguiente). */
const LIVE_DAYS = 3;

const dayStr = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Lunes de la semana (lunes a domingo) de un día YYYY-MM-DD. */
export function weekStartOf(day: string): string {
  const dow = new Date(`${day}T12:00:00.000Z`).getUTCDay(); // 0 = domingo
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

@Injectable()
export class DailyTasksService {
  constructor(
    @InjectRepository(DailyTask) private readonly repo: Repository<DailyTask>,
    @InjectRepository(DailyLd) private readonly ldRepo: Repository<DailyLd>,
    @InjectRepository(OpsAlertSubsidiary) private readonly subRepo: Repository<OpsAlertSubsidiary>,
    private readonly facts: DailyTaskFactsService,
    private readonly opsAlerts: OpsAlertsService,
    private readonly ds: DataSource,
  ) {}

  async schedule(subsidiaryId: string): Promise<{ schedule: Schedule; cfg: OpsAlertSubsidiary | null }> {
    const [global, cfg] = await Promise.all([this.opsAlerts.getSettings(), this.subRepo.findOne({ where: { subsidiaryId } })]);
    return { schedule: resolveSchedule(global, cfg as Partial<Schedule> | null), cfg };
  }

  private async compute(subsidiaryId: string, day: string, now: Date): Promise<TaskRow[]> {
    const { schedule, cfg } = await this.schedule(subsidiaryId);
    const [sub, cons] = await Promise.all([this.facts.subsidiaryFacts(subsidiaryId, day), this.facts.consolidatedFacts(subsidiaryId, day)]);
    const rows = [...subsidiaryTasks(subsidiaryId, sub, schedule, now), ...cons.flatMap((f) => consolidatedTasks(f, schedule, now))];
    return rows.filter((r) => !cfg || cfg[STEP_FLAG[r.step]] !== false);
  }

  private async saved(subsidiaryId: string, day: string): Promise<DailyTask[]> {
    return this.repo.find({ where: { subsidiaryId, day } });
  }

  /** Recalcula un día, guarda la foto y devuelve los cambios de estado. Solo lee la operación; no marca nada. */
  async refreshDay(subsidiaryId: string, day: string, now = new Date()): Promise<DayTransition[]> {
    const prev = await this.saved(subsidiaryId, day);
    const next = await this.compute(subsidiaryId, day, now);
    const byKey = new Map(prev.map((p) => [taskKey(p), p]));
    const keep = new Set<string>();
    const toSave: DailyTask[] = [];
    for (const r of next) {
      const k = taskKey(r);
      keep.add(k);
      const ex = byKey.get(k);
      const changed = !ex || ex.status !== r.status || ex.doneCount !== r.doneCount || ex.totalCount !== r.totalCount || +ex.dueAt !== +r.dueAt || +(ex.doneAt ?? 0) !== +(r.doneAt ?? 0);
      if (changed) toSave.push(this.repo.create({ ...(ex ?? {}), ...r, subsidiaryId, day }));
    }
    if (toSave.length) await this.repo.save(toSave, { chunk: 200 });
    const gone = prev.filter((p) => !keep.has(taskKey(p))).map((p) => p.id);
    if (gone.length) await this.repo.delete({ id: In(gone) });
    return diffTasks(prev as unknown as TaskRow[], next).map((t) => ({ ...t, subsidiaryId, day }));
  }

  async activeSubsidiaries(): Promise<{ id: string; name: string }[]> {
    return this.ds.query('SELECT id, name FROM subsidiary WHERE active = 1 ORDER BY name');
  }

  /** Lo que corre el cron: hoy y los días recientes de la semana en curso, todas las sucursales activas. */
  async refreshOpenDays(now = new Date()): Promise<DayTransition[]> {
    const today = localDay(now);
    const monday = weekStartOf(today);
    const days: string[] = [];
    for (let i = 0; i < LIVE_DAYS; i++) {
      const d = addDays(today, -i);
      if (d >= monday) days.push(d);
    }
    const out: DayTransition[] = [];
    for (const s of await this.activeSubsidiaries()) {
      for (const d of days) out.push(...(await this.refreshDay(s.id, d, now)));
    }
    return out;
  }

  async week(subsidiaryId: string, weekStart: string, now = new Date()) {
    const today = localDay(now);
    const start = weekStartOf(weekStart);
    const end = addDays(start, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    let rows = await this.repo.find({ where: { subsidiaryId, day: Between(start, end) } });
    const missing = days.filter((d) => d <= today && !rows.some((r) => dayStr(r.day) === d));
    if (missing.length) {
      for (const d of missing) await this.refreshDay(subsidiaryId, d, now);
      rows = await this.repo.find({ where: { subsidiaryId, day: Between(start, end) } });
    }
    return {
      weekStart: start,
      days: days.map((day) => {
        const r = rows.filter((x) => dayStr(x.day) === day);
        const done = r.filter((x) => x.status === 'done').length;
        return { day, total: r.length, done, late: r.filter((x) => x.status === 'late').length, pct: r.length ? Math.round((done / r.length) * 100) : 0 };
      }),
    };
  }

  async day(subsidiaryId: string, day: string, now = new Date()) {
    const today = localDay(now);
    if (day === today) await this.refreshDay(subsidiaryId, day, now);
    let rows = await this.saved(subsidiaryId, day);
    if (!rows.length && day < today) {
      await this.refreshDay(subsidiaryId, day, now);
      rows = await this.saved(subsidiaryId, day);
    }
    const asRow = (r: DailyTask): TaskRow => ({
      refType: r.refType, refId: r.refId, consNumber: r.consNumber, step: r.step, status: r.status, doneCount: r.doneCount, totalCount: r.totalCount,
      dueAt: r.dueAt, doneAt: r.doneAt, doneById: r.doneById, doneByName: r.doneByName,
    });
    const STEP_ORDER: TaskStep[] = ['upload', 'unloading', 'dispatch', 'closure', 'devolutions', 'inventory_initial', 'inventory_final'];
    const byOrder = (a: TaskRow, b: TaskRow) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step);
    const subsidiary = rows.filter((r) => r.refType === 'subsidiary').map(asRow).sort(byOrder);
    const refs = [...new Map(rows.filter((r) => r.refType !== 'subsidiary').map((r) => [`${r.refType}:${r.refId}`, r])).values()];
    const meta = await this.consolidatedMeta(refs.map((r) => ({ refType: r.refType, refId: r.refId })));
    const consolidated = refs.map((r) => ({
      refType: r.refType as 'consolidated' | 'charge', refId: r.refId, consNumber: r.consNumber ?? '',
      ...(meta.get(r.refId) ?? { carrier: 'fedex', type: '', guides: 0 }),
      tasks: rows.filter((x) => x.refId === r.refId).map(asRow).sort(byOrder),
    }));

    let carriedOver: { day: string; consNumber: string; refType: TaskRefType; refId: string; lateSteps: TaskStep[] }[] = [];
    if (day === today) {
      const monday = weekStartOf(day);
      if (monday < day) {
        const prev = await this.repo.find({ where: { subsidiaryId, day: Between(monday, addDays(day, -1)), refType: Not('subsidiary') as any, status: Not('done') as any } });
        const g = new Map<string, (typeof carriedOver)[number]>();
        for (const p of prev) {
          const k = `${p.refType}:${p.refId}`;
          const e = g.get(k) ?? { day: dayStr(p.day), consNumber: p.consNumber ?? '', refType: p.refType, refId: p.refId, lateSteps: [] };
          if (p.status === 'late') e.lateSteps.push(p.step);
          g.set(k, e);
        }
        carriedOver = [...g.values()];
      }
    }

    const possibleLd =
      day === today
        ? (await this.facts.ldCandidates(subsidiaryId, day)).map((c) => ({ trackingNumber: c.trackingNumber, consNumber: c.consNumber, bucket: c.bucket }))
        : (await this.ldRepo.find({ where: { subsidiaryId, day } })).map((l) => ({ trackingNumber: l.trackingNumber, consNumber: l.consNumber ?? '', bucket: l.status ?? '' }));

    return { day, isToday: day === today, subsidiary, consolidated, carriedOver, possibleLd };
  }

  private async consolidatedMeta(refs: { refType: string; refId: string }[]): Promise<Map<string, { carrier: string; type: string; guides: number }>> {
    const out = new Map<string, { carrier: string; type: string; guides: number }>();
    const m = refs.filter((r) => r.refType === 'consolidated').map((r) => r.refId);
    const c = refs.filter((r) => r.refType === 'charge').map((r) => r.refId);
    if (m.length) {
      const rows: any[] = await this.ds.query(
        `SELECT c.id, c.carrier, c.type, (SELECT COUNT(*) FROM shipment s WHERE s.consolidatedId = c.id AND s.active = 1) guides FROM consolidated c WHERE c.id IN (${m.map(() => '?').join(',')})`,
        m,
      );
      for (const r of rows) out.set(r.id, { carrier: r.carrier ?? 'fedex', type: r.type ?? '', guides: Number(r.guides) });
    }
    if (c.length) {
      const rows: any[] = await this.ds.query(
        `SELECT ch.id, (SELECT COUNT(*) FROM charge_shipment s WHERE s.chargeId = ch.id AND s.active = 1) guides FROM charge ch WHERE ch.id IN (${c.map(() => '?').join(',')})`,
        c,
      );
      for (const r of rows) out.set(r.id, { carrier: 'fedex', type: 'F2', guides: Number(r.guides) });
    }
    return out;
  }

  /** Foto de LD del día (cron 20:30). Idempotente: no duplica guías ya guardadas. */
  async snapshotLd(subsidiaryId: string, day: string): Promise<number> {
    const cands = await this.facts.ldCandidates(subsidiaryId, day);
    if (!cands.length) return 0;
    await this.ldRepo
      .createQueryBuilder()
      .insert()
      .into(DailyLd)
      .values(cands.map((c) => ({ subsidiaryId, day, trackingNumber: c.trackingNumber, shipmentId: c.shipmentId, chargeShipmentId: c.chargeShipmentId, consNumber: c.consNumber, status: c.bucket })))
      .orIgnore()
      .execute();
    return cands.length;
  }

  /** Sucursal dueña de un consolidado / carga (para validar acceso al detalle). */
  async subsidiaryOfRef(refType: 'consolidated' | 'charge', refId: string): Promise<string | null> {
    const table = refType === 'charge' ? 'charge' : 'consolidated';
    const rows: any[] = await this.ds.query(`SELECT subsidiaryId FROM ${table} WHERE id = ?`, [refId]);
    return rows[0]?.subsidiaryId ?? null;
  }

  packageDetail(refType: 'consolidated' | 'charge', refId: string, now = new Date()) {
    return this.facts.packageDetail(refType, refId, localDay(now));
  }
}
