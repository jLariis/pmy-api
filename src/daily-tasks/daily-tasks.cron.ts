import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { OpsAlert, OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { DailyTask } from '../entities/daily-task.entity';
import { OpsAlertsService } from '../ops-alerts/ops-alerts.service';
import { SendLogService } from '../ops-alerts/send-log.service';
import { addDays, alertLevel, inActiveHours, localDay } from '../ops-alerts/ops-alerts.util';
import { DailyTasksService, DayTransition } from './daily-tasks.service';
import { alertRefKey, dayDigest, tasksLink, transitionMessage } from './daily-task-notify.util';
import { escalationActions } from './daily-task-escalation.util';
import { doneToNotify, liveDays, shouldAlertNew, stepAlertsEnabled } from './daily-task-rules.util';
import { TaskRow } from './daily-task.types';

const ZONE = { timeZone: 'America/Hermosillo' };

/**
 * Avisos de Tareas del día sobre el motor de ops-alerts: cada 5 min recalcula y avisa
 * cambios (completado / atraso con escalamiento sin repetir vía `ops_alert`); 19:00 resumen
 * por correo; 20:00 WhatsApp si no hay inventario final; 20:30 foto de LD.
 * Respeta el interruptor general y el horario activo (06:00–21:30).
 */
@Injectable()
export class DailyTasksNotifier {
  private readonly logger = new Logger(DailyTasksNotifier.name);
  private running = false;
  /** Arranque del proceso: lo que ya venía vencido antes no se avisa (sin ráfaga al desplegar). */
  private bootAt = new Date();

  constructor(
    private readonly tasks: DailyTasksService,
    private readonly opsAlerts: OpsAlertsService,
    private readonly sendLog: SendLogService,
    @InjectRepository(OpsAlert) private readonly alertRepo: Repository<OpsAlert>,
    @InjectRepository(OpsAlertSubsidiary) private readonly subRepo: Repository<OpsAlertSubsidiary>,
    @InjectRepository(DailyTask) private readonly taskRepo: Repository<DailyTask>,
    private readonly ds: DataSource,
  ) {}

  private ctx(subsidiaryId: string, consNumber: string | null = null) {
    return { origin: 'alerta' as const, sentById: null, sentByName: null, subsidiaryId, consNumber };
  }

  private async names(): Promise<Map<string, string>> {
    return new Map((await this.tasks.activeSubsidiaries()).map((s) => [s.id, s.name]));
  }

  /** Cada 5 min: recalcula hoy y días recientes; avisa completados y escala atrasos. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tasks.refreshOpenDays(now);
      const s = await this.opsAlerts.getSettings();
      if (s.enabled && !inActiveHours(now, s)) return; // fuera de horario: se avisa al volver
      const names = await this.names();
      await this.notifyDone(now, s.enabled, names);
      if (s.enabled) await this.escalate(now, s, names);
    } finally {
      this.running = false;
    }
  }

  /**
   * "Listo": filas que terminaron y no se han avisado (`notifiedStatus`), las haya guardado el
   * cron o la pantalla. Con las alertas apagadas o el paso callado se marcan sin avisar.
   */
  private async notifyDone(now: Date, enabled: boolean, names: Map<string, string>) {
    const rows = doneToNotify(await this.taskRepo.find({ where: { status: 'done', day: In(liveDays(localDay(now))) } }));
    for (const r of rows) {
      const day = String(r.day).slice(0, 10);
      const t: DayTransition = { row: r as unknown as TaskRow, from: r.notifiedStatus, to: 'done', subsidiaryId: r.subsidiaryId, day };
      await this.resolveAlert(t, now);
      const cfg = await this.subRepo.findOne({ where: { subsidiaryId: r.subsidiaryId } });
      const m = enabled && stepAlertsEnabled(cfg, r.step) ? transitionMessage(t, names.get(r.subsidiaryId) ?? '') : null;
      if (m) await this.sendLog.notifyUsers(await this.opsAlerts.subsidiaryUsers(r.subsidiaryId), { ...m, severity: 'info' }, this.ctx(r.subsidiaryId, r.consNumber));
      r.notifiedStatus = 'done';
      await this.taskRepo.save(r);
    }
  }

  private async resolveAlert(t: DayTransition, now: Date) {
    const a = await this.alertRepo.findOne({ where: { refKey: alertRefKey(t), resolvedAt: IsNull() } });
    if (!a) return;
    a.resolvedAt = t.row.doneAt ?? now;
    a.progressPct = 100;
    a.lateMinutes = Math.max(0, Math.round((a.resolvedAt.getTime() - a.dueAt.getTime()) / 60_000));
    await this.alertRepo.save(a);
  }

  /** Atrasos de hoy y días recientes: sube de nivel una sola vez por nivel (registro en ops_alert). */
  private async escalate(now: Date, s: Awaited<ReturnType<OpsAlertsService['getSettings']>>, names: Map<string, string>) {
    const today = localDay(now);
    const late = await this.taskRepo.find({ where: { status: 'late', day: In(liveDays(today)) } });
    for (const r of late) {
      const day = String(r.day).slice(0, 10);
      const cfg = await this.subRepo.findOne({ where: { subsidiaryId: r.subsidiaryId } });
      if (!stepAlertsEnabled(cfg, r.step)) continue;
      const t: DayTransition = { row: r as unknown as TaskRow, from: null, to: 'late', subsidiaryId: r.subsidiaryId, day };
      const level = alertLevel(r.dueAt, now, s);
      if (!level) continue;
      const refKey = alertRefKey(t);
      const existing = await this.alertRepo.findOne({ where: { step: `dt_${r.step}`, refKey } });
      const alert =
        existing ??
        this.alertRepo.create({
          subsidiaryId: r.subsidiaryId, step: `dt_${r.step}`, refKey, inboxConsolidationId: null, consNumber: r.consNumber,
          consolidatedId: r.refType === 'consolidated' ? r.refId : null, chargeId: r.refType === 'charge' ? r.refId : null, level: 0,
        });
      if (alert.resolvedAt) continue;
      if (!existing && !shouldAlertNew(day, today, r.dueAt, this.bootAt)) {
        alert.level = level; // se registra en silencio; solo escala si sube de aquí
        alert.dueAt = r.dueAt;
        await this.alertRepo.save(alert);
        continue;
      }
      const act = escalationActions(level, alert.level, s.alertGroupsLevel ?? 1);
      alert.dueAt = r.dueAt;
      alert.progressPct = r.totalCount ? Math.floor((r.doneCount / r.totalCount) * 100) : 0;
      if (act.bell) {
        const m = transitionMessage(t, names.get(r.subsidiaryId) ?? '');
        if (m) {
          const event = { ...m, severity: (level >= 2 ? 'error' : 'warning') as 'error' | 'warning' };
          const ctx = this.ctx(r.subsidiaryId, r.consNumber);
          await this.sendLog.notifyUsers(await this.opsAlerts.subsidiaryUsers(r.subsidiaryId), event, ctx);
          if (act.managersEmail && cfg?.managerUserIds?.length) await this.sendLog.notifyUsers(cfg.managerUserIds, event, ctx, true);
          if (act.whatsapp) await this.whatsapp(cfg, `*${m.title}*\n${m.body}`, ctx, m.title);
        }
        alert.notifiedAt = now;
      }
      alert.level = Math.max(alert.level, level);
      await this.alertRepo.save(alert);
    }
  }

  private async whatsapp(cfg: OpsAlertSubsidiary | null, text: string, ctx: ReturnType<DailyTasksNotifier['ctx']>, title: string) {
    for (const n of cfg?.whatsappNumbers ?? []) await this.sendLog.whatsappTo({ id: n, name: n }, text, ctx, title);
    for (const g of cfg?.whatsappGroups ?? []) await this.sendLog.whatsappTo(g, text, ctx, title);
  }

  /** 19:00: resumen por correo a encargados (o a la sucursal si no hay) + campana si falta el inventario final. */
  async dailyDigest(now = new Date()): Promise<void> {
    const s = await this.opsAlerts.getSettings();
    if (!s.enabled) return;
    const day = localDay(now);
    for (const [subsidiaryId, name] of await this.names()) {
      const d = await this.tasks.day(subsidiaryId, day, now);
      if (!d.consolidated.length && !d.subsidiary.some((r) => r.status === 'done')) continue; // sucursal sin operación hoy
      const dg = dayDigest(name, day, d);
      const cfg = await this.subRepo.findOne({ where: { subsidiaryId } });
      const users = await this.opsAlerts.subsidiaryUsers(subsidiaryId);
      const managers = cfg?.managerUserIds?.length ? cfg.managerUserIds : users;
      const link = tasksLink(subsidiaryId, day);
      await this.sendLog.notifyUsers(managers, { type: 'tareas.resumen_dia', title: dg.subject, body: dg.text, severity: 'info', link }, this.ctx(subsidiaryId), true);
      const inv = d.subsidiary.find((r) => r.step === 'inventory_final');
      if (inv && inv.status !== 'done') {
        await this.sendLog.notifyUsers(users, { type: 'tareas.inventario_final_pendiente', title: 'Inventario final de día pendiente', body: `${name} · hazlo antes de las ${this.hhmm(inv.dueAt)}; el sistema se suspende 21:30`, severity: 'warning', link }, this.ctx(subsidiaryId));
      }
    }
  }

  /** 20:00: WhatsApp a la sucursal si el inventario final sigue sin hacerse. */
  async inventoryFinalWhatsapp(now = new Date()): Promise<void> {
    const s = await this.opsAlerts.getSettings();
    if (!s.enabled || !inActiveHours(now, s)) return;
    const day = localDay(now);
    for (const [subsidiaryId, name] of await this.names()) {
      await this.tasks.refreshDay(subsidiaryId, day, now);
      const inv = await this.taskRepo.findOne({ where: { subsidiaryId, day, refType: 'subsidiary', step: 'inventory_final' } });
      if (!inv || inv.status === 'done') continue;
      const cfg = await this.subRepo.findOne({ where: { subsidiaryId } });
      if (!stepAlertsEnabled(cfg, 'inventory_final')) continue;
      const left: any[] = await this.ds.query(
        `SELECT COUNT(*) n FROM shipment WHERE subsidiaryId = ? AND active = 1 AND LOWER(status) IN ('en_bodega', 'pendiente')`,
        [subsidiaryId],
      );
      const text = `*PMY · ${name}*\nEl inventario final de día de hoy vence a las ${this.hhmm(inv.dueAt)} y aún no se ha hecho. Quedan ${Number(left[0]?.n ?? 0)} guías en bodega.`;
      await this.whatsapp(cfg, text, this.ctx(subsidiaryId), 'Inventario final de día pendiente');
    }
  }

  async snapshotLd(now = new Date()): Promise<void> {
    const day = localDay(now);
    for (const id of (await this.names()).keys()) {
      try {
        await this.tasks.snapshotLd(id, day);
      } catch (e: any) {
        this.logger.warn(`[tareas] foto de LD ${id}: ${e?.message ?? e}`);
      }
    }
  }

  private hhmm(d: Date) {
    return new Date(new Date(d).getTime() - 7 * 3_600_000).toISOString().slice(11, 16);
  }

  // ------------------------------------------------------------------ crons

  @Cron('30 */5 * * * *', ZONE)
  async runTick() {
    await this.safe('revisión', () => this.tick());
  }

  @Cron('0 0 19 * * *', ZONE)
  async runDigest() {
    await this.safe('resumen 19:00', () => this.dailyDigest());
  }

  @Cron('0 0 20 * * *', ZONE)
  async runInventoryWhatsapp() {
    await this.safe('inventario final 20:00', () => this.inventoryFinalWhatsapp());
  }

  @Cron('0 30 20 * * *', ZONE)
  async runSnapshotLd() {
    await this.safe('foto LD 20:30', () => this.snapshotLd());
  }

  private async safe(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e: any) {
      this.logger.error(`⏰ [tareas] ${what}: ${e?.message ?? e}`);
    }
  }
}
