import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { OpsAlert, OpsAlertSettings, OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { WhatsappGatewayService } from '../whatsapp-gateway/whatsapp-gateway.service';
import { LifecycleService } from './lifecycle.service';
import { AlertBlock, buildAlertDigest, buildAlertMessage, pickUsualUploaders } from './alert-digest.util';
import { analyzeConsolidated, isWrongType } from './consolidated-analysis.util';
import { devWhatsappRedirect } from './send-log.service';
import { SendLogService } from './send-log.service';
import { DEFAULT_UPLOAD_GROUPS } from '../inbox/upload-message.util';
import { hermosilloDateTimeText } from '../common/hermosillo-text.util';
import {
  alertLevel,
  atLocalTime,
  computeSteps,
  inActiveHours,
  Lifecycle,
  localDay,
  OpsSettings,
  OpsStep,
  STEP_LABEL,
  StepsEnabled,
  StepStatus,
} from './ops-alerts.util';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_ON: StepsEnabled = { upload: true, unloading: true, dispatch: true, closure: true, inventory: true };

export interface EvaluateReport {
  skipped?: string;
  checked: number;
  opened: number;
  notified: number;
  resolved: number;
}

const KIND_LABEL: Record<string, string> = { master: 'Master', f2: 'F2 (carga)', aereo: 'Aéreo', high_value: 'Alto valor', cod: 'COD', dhl: 'DHL' };

/**
 * Alertas operativas: revisa el recorrido de los consolidados que llegaron por correo
 * contra los plazos configurados y avisa escalando (sucursal → encargado → supervisión).
 */
@Injectable()
export class OpsAlertsService {
  private readonly logger = new Logger(OpsAlertsService.name);
  private running = false;
  /** Alertas nuevas o que subieron de nivel en la revisión en curso (para el mensaje a grupos). */
  private digest: AlertBlock[] = [];
  /** Quién sube normalmente, por sucursal (se calcula una vez por revisión). */
  private uploaderCache = new Map<string, string[]>();

  constructor(
    @InjectRepository(OpsAlertSettings) private readonly settingsRepo: Repository<OpsAlertSettings>,
    @InjectRepository(OpsAlertSubsidiary) private readonly subRepo: Repository<OpsAlertSubsidiary>,
    @InjectRepository(OpsAlert) private readonly alertRepo: Repository<OpsAlert>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly lifecycle: LifecycleService,
    private readonly whatsapp: WhatsappGatewayService,
    private readonly ds: DataSource,
    private readonly sendLog: SendLogService,
  ) {}

  // ------------------------------------------------------------------ configuración

  async getSettings(): Promise<OpsAlertSettings> {
    let s = (await this.settingsRepo.find({ take: 1 }))[0];
    if (!s) s = await this.settingsRepo.save(this.settingsRepo.create({}));
    return s;
  }

  async updateSettings(patch: Partial<OpsAlertSettings>, userId: string | null): Promise<OpsAlertSettings> {
    const s = await this.getSettings();
    for (const k of ['unloadingTime', 'dispatchTime', 'closureTime', 'inventoryTime', 'activeFrom', 'activeTo'] as const) {
      if (patch[k] !== undefined) {
        if (!HHMM.test(String(patch[k]))) throw new BadRequestException('Escribe la hora como HH:MM (por ejemplo 21:00)');
        s[k] = String(patch[k]);
      }
    }
    for (const k of ['uploadMinutes', 'escalate1Min', 'escalate2Min', 'completePct', 'lookbackDays'] as const) {
      if (patch[k] !== undefined) {
        const n = Number(patch[k]);
        if (!Number.isInteger(n) || n < 1) throw new BadRequestException('Los minutos, días y porcentajes deben ser números enteros mayores a cero');
        s[k] = n;
      }
    }
    if (s.completePct > 100) throw new BadRequestException('El porcentaje no puede pasar de 100');
    if (s.escalate2Min <= s.escalate1Min) throw new BadRequestException('El segundo aviso debe ser después del primero');
    if (patch.uploadNotifyEnabled !== undefined) s.uploadNotifyEnabled = !!patch.uploadNotifyEnabled;
    if (patch.uploadNotifyGroups !== undefined) {
      s.uploadNotifyGroups = (patch.uploadNotifyGroups ?? []).filter((g) => g?.id?.endsWith('@g.us')).map((g) => ({ id: g.id, name: String(g.name ?? '') }));
    }
    if (patch.alertGroupsEnabled !== undefined) s.alertGroupsEnabled = !!patch.alertGroupsEnabled;
    if (patch.alertGroupsLevel !== undefined) {
      const n = Number(patch.alertGroupsLevel);
      if (![1, 2, 3].includes(n)) throw new BadRequestException('Elige desde qué aviso se manda a los grupos');
      s.alertGroupsLevel = n;
    }
    if (patch.enabled !== undefined) {
      if (!!patch.enabled && !s.enabled) s.enabledAt = new Date();
      s.enabled = !!patch.enabled;
    }
    s.updatedById = userId;
    return this.settingsRepo.save(s);
  }

  /** Todas las sucursales activas con su configuración (o la de por defecto). */
  async listSubsidiaryConfig() {
    const subs: { id: string; name: string }[] = await this.ds.query('SELECT id, name FROM subsidiary WHERE active = 1 ORDER BY name');
    const cfgs = await this.subRepo.find();
    return subs.map((s) => {
      const c = cfgs.find((x) => x.subsidiaryId === s.id);
      return {
        subsidiaryId: s.id,
        subsidiaryName: s.name,
        stepUpload: c?.stepUpload ?? true,
        stepUnloading: c?.stepUnloading ?? true,
        stepDispatch: c?.stepDispatch ?? true,
        stepClosure: c?.stepClosure ?? true,
        stepInventory: c?.stepInventory ?? true,
        managerUserIds: c?.managerUserIds ?? [],
        whatsappNumbers: c?.whatsappNumbers ?? [],
        whatsappGroups: c?.whatsappGroups ?? [],
      };
    });
  }

  async updateSubsidiaryConfig(subsidiaryId: string, patch: Partial<OpsAlertSubsidiary>): Promise<OpsAlertSubsidiary> {
    const exists: any[] = await this.ds.query('SELECT id FROM subsidiary WHERE id = ?', [subsidiaryId]);
    if (!exists.length) throw new BadRequestException('Esa sucursal no existe');
    const c = (await this.subRepo.findOne({ where: { subsidiaryId } })) ?? this.subRepo.create({ subsidiaryId });
    for (const k of ['stepUpload', 'stepUnloading', 'stepDispatch', 'stepClosure', 'stepInventory'] as const) {
      if (patch[k] !== undefined) c[k] = !!patch[k];
    }
    if (patch.managerUserIds !== undefined) c.managerUserIds = [...new Set((patch.managerUserIds ?? []).map(String))];
    if (patch.whatsappNumbers !== undefined) {
      const nums = (patch.whatsappNumbers ?? []).map((n) => String(n).replace(/\D/g, '')).filter(Boolean);
      if (nums.some((n) => n.length < 10)) throw new BadRequestException('Cada número de WhatsApp debe tener al menos 10 dígitos (con lada del país, p. ej. 52…)');
      c.whatsappNumbers = [...new Set(nums)];
    }
    if (patch.whatsappGroups !== undefined) {
      c.whatsappGroups = (patch.whatsappGroups ?? []).filter((g) => g?.id?.endsWith('@g.us')).map((g) => ({ id: g.id, name: String(g.name ?? '') }));
    }
    return this.subRepo.save(c);
  }

  async whatsappGroups() {
    try {
      return await this.whatsapp.getGroups();
    } catch {
      throw new BadRequestException('WhatsApp no está conectado. Vincula un número en Configuración → WhatsApp.');
    }
  }

  private async cfgMap(): Promise<Map<string, OpsAlertSubsidiary>> {
    return new Map((await this.subRepo.find()).map((c) => [c.subsidiaryId, c]));
  }

  private stepsOf(c: OpsAlertSubsidiary | undefined): StepsEnabled {
    if (!c) return ALL_ON;
    return { upload: c.stepUpload, unloading: c.stepUnloading, dispatch: c.stepDispatch, closure: c.stepClosure, inventory: c.stepInventory };
  }

  // ------------------------------------------------------------------ recorrido

  private async recentConsolidations(s: OpsSettings, now: Date, extraWhere: Record<string, unknown> = {}) {
    const since = new Date(now.getTime() - s.lookbackDays * 86_400_000);
    const rows = await this.consRepo.find({
      where: { receivedAt: MoreThanOrEqual(since), linkStatus: Not('no_aplica'), subsidiaryId: Not(IsNull()), kind: In(['master', 'aereo', 'f2']), ...extraWhere },
      order: { receivedAt: 'DESC' },
    });
    // Subidos con el tipo equivocado: sus guías se siguen dentro del consolidado donde quedaron.
    return rows.filter((c) => !isWrongType(c));
  }

  /** Recorrido + pasos + alertas de una lista de consolidados (para pantallas). */
  async tracking(all: InboxConsolidation[]) {
    // Subidos con el tipo equivocado no van aparte: sus guías se siguen en el consolidado donde quedaron.
    const list = all.filter((c) => !isWrongType(c));
    const s = await this.getSettings();
    const cfg = await this.cfgMap();
    const lc = await this.lifecycle.forConsolidations(list);
    const alerts = list.length ? await this.alertRepo.find({ where: { inboxConsolidationId: In(list.map((c) => c.id)) } }) : [];
    const now = new Date();
    return list.map((c) => {
      const l = lc.get(c.id) as Lifecycle;
      const steps = computeSteps(l, s, this.stepsOf(cfg.get(c.subsidiaryId as string)));
      return {
        inboxConsolidationId: c.id,
        inboxMessageId: c.inboxMessageId,
        consNumber: c.consNumber,
        /** Se subió con otro número (p. ej. la F2 con el número del master). */
        uploadedAs: c.uploadedAs ?? null,
        kind: c.kind,
        subsidiaryId: c.subsidiaryId,
        announcedCount: c.announcedCount,
        receivedAt: c.receivedAt,
        guides: l.unloading.total,
        progress: {
          unloading: l.unloading.done,
          dispatch: l.dispatch.done,
          closure: l.closure.done,
          unloadingAt: l.unloading.last,
          dispatchAt: l.dispatch.first,
          closureAt: l.closure.last,
        },
        steps: steps.map((st) => ({ ...st, late: !st.done && now.getTime() > st.dueAt.getTime() })),
        alerts: alerts.filter((a) => a.inboxConsolidationId === c.id && !a.resolvedAt).map((a) => ({ step: a.step, level: a.level, dueAt: a.dueAt })),
      };
    });
  }

  // ------------------------------------------------------------------ revisor

  async evaluate(now = new Date(), force = false): Promise<EvaluateReport> {
    const report: EvaluateReport = { checked: 0, opened: 0, notified: 0, resolved: 0 };
    if (this.running) return { ...report, skipped: 'Ya hay una revisión en curso' };
    const s = await this.getSettings();
    if (!s.enabled && !force) return { ...report, skipped: 'Las alertas están apagadas' };
    this.running = true;
    this.digest = [];
    this.uploaderCache.clear();
    try {
      const active = inActiveHours(now, s);
      const cfg = await this.cfgMap();
      const list = await this.recentConsolidations(s, now);
      const lc = await this.lifecycle.forConsolidations(list);
      for (const c of list) {
        const steps = computeSteps(lc.get(c.id) as Lifecycle, s, this.stepsOf(cfg.get(c.subsidiaryId as string)));
        for (const st of steps) {
          report.checked++;
          await this.apply(st, { refKey: c.id, subsidiaryId: c.subsidiaryId as string, inboxConsolidationId: c.id, consNumber: c.consNumber, cons: c, lifecycle: lc.get(c.id) ?? null }, s, now, active, cfg, report);
        }
      }
      await this.evaluateInventory(s, now, active, cfg, list, report);
      if (this.digest.length && s.alertGroupsEnabled) await this.sendDigest(now);
    } finally {
      this.running = false;
    }
    if (report.opened || report.notified || report.resolved) {
      this.logger.log(`⏰ [ops-alerts] revisados=${report.checked} nuevas=${report.opened} avisos=${report.notified} resueltas=${report.resolved}`);
    }
    return report;
  }

  /** Inventario: una revisión diaria por sucursal (las que trabajan con la bandeja o tienen configuración). */
  private async evaluateInventory(s: OpsSettings, now: Date, active: boolean, cfg: Map<string, OpsAlertSubsidiary>, list: InboxConsolidation[], report: EvaluateReport) {
    const day = localDay(now);
    const dueAt = atLocalTime(day, s.inventoryTime);
    const subs = new Set<string>([...list.map((c) => c.subsidiaryId as string), ...cfg.keys()]);
    for (const subsidiaryId of subs) {
      if (!this.stepsOf(cfg.get(subsidiaryId)).inventory) continue;
      const doneAt = await this.inventoryDoneAt(subsidiaryId, day);
      report.checked++;
      await this.apply(
        { step: 'inventory' as never, dueAt, done: !!doneAt, doneAt, pct: doneAt ? 100 : 0 },
        { refKey: `${subsidiaryId}:${day}`, subsidiaryId, inboxConsolidationId: null, consNumber: null, cons: null, lifecycle: null },
        s,
        now,
        active,
        cfg,
        report,
      );
    }
  }

  private async inventoryDoneAt(subsidiaryId: string, day: string): Promise<Date | null> {
    const done: any[] = await this.ds.query(
      `SELECT MIN(createdAt) AS at FROM inventory WHERE subsidiaryId = ? AND inventoryDate >= ? AND inventoryDate < ?`,
      [subsidiaryId, atLocalTime(day, '00:00'), atLocalTime(day, '23:59')],
    );
    return done[0]?.at ? new Date(done[0].at) : null;
  }

  private async apply(
    st: StepStatus | { step: OpsStep; dueAt: Date; done: boolean; doneAt: Date | null; pct: number },
    ref: { refKey: string; subsidiaryId: string; inboxConsolidationId: string | null; consNumber: string | null; cons: InboxConsolidation | null; lifecycle: Lifecycle | null },
    s: OpsSettings,
    now: Date,
    active: boolean,
    cfg: Map<string, OpsAlertSubsidiary>,
    report: EvaluateReport,
  ) {
    const existing = await this.alertRepo.findOne({ where: { step: st.step as OpsStep, refKey: ref.refKey } });
    if (st.done) {
      if (existing && !existing.resolvedAt) {
        existing.resolvedAt = st.doneAt ?? now;
        existing.lateMinutes = Math.max(0, Math.round((existing.resolvedAt.getTime() - existing.dueAt.getTime()) / 60_000));
        existing.progressPct = 100;
        await this.alertRepo.save(existing);
        report.resolved++;
      }
      return;
    }
    const level = alertLevel(st.dueAt, now, s);
    if (level === 0) return;
    const alert =
      existing ??
      this.alertRepo.create({ subsidiaryId: ref.subsidiaryId, step: st.step as OpsStep, refKey: ref.refKey, inboxConsolidationId: ref.inboxConsolidationId, consNumber: ref.consNumber, level: 0 });
    if (!existing) report.opened++;
    if (alert.resolvedAt) return; // ya se resolvió y luego retrocedió el avance: no se reabre
    alert.dueAt = st.dueAt;
    alert.progressPct = st.pct;
    // Fuera de horario no se avisa; al volver se manda solo el nivel vigente, una vez.
    // Lo que ya venía vencido antes de prender las alertas se registra pero no se avisa.
    const enabledAt = (s as OpsSettings & { enabledAt?: Date | null }).enabledAt ?? null;
    const beforeActivation = !!enabledAt && st.dueAt.getTime() < new Date(enabledAt).getTime();
    if (beforeActivation) alert.level = Math.max(alert.level, level);
    if (active && !beforeActivation && level > alert.level) {
      await this.notify(level, alert, st, ref.cons, ref.lifecycle, now, cfg.get(ref.subsidiaryId));
      alert.level = level;
      alert.notifiedAt = now;
      report.notified++;
    }
    await this.alertRepo.save(alert);
  }

  // ------------------------------------------------------------------ avisos

  async subsidiaryUsers(subsidiaryId: string): Promise<string[]> {
    const rows: any[] = await this.ds.query(
      `SELECT DISTINCT u.id FROM \`user\` u LEFT JOIN user_subsidiary us ON us.userId = u.id
       WHERE u.active = 1 AND (u.subsidiaryId = ? OR us.subsidiaryId = ?)`,
      [subsidiaryId, subsidiaryId],
    );
    return rows.map((r) => r.id);
  }

  /** Bloque de una alerta (mismo estilo que "Mandar aviso"): avance, paso vencido y hallazgos del análisis. */
  private async buildBlock(
    level: number,
    subsidiaryId: string,
    st: { step: OpsStep | string; dueAt: Date; pct: number },
    cons: InboxConsolidation | null,
    lifecycle: Lifecycle | null,
    now: Date,
  ): Promise<AlertBlock> {
    const sub: any[] = await this.ds.query('SELECT name FROM subsidiary WHERE id = ?', [subsidiaryId]);
    const guides = cons ? await this.lifecycle.guideFacts((cons.uploadedAsKind ?? (cons.kind === 'f2' ? 'f2' : 'master')) as 'f2' | 'master', cons.uploadedAs || cons.consNumber) : [];
    const findings = cons ? analyzeConsolidated({ receivedAt: cons.receivedAt, announcedCount: cons.announcedCount, guides, now }) : [];
    return {
      level,
      subsidiaryId,
      subsidiaryName: sub[0]?.name ?? 'Sucursal',
      step: STEP_LABEL[st.step as OpsStep] ?? String(st.step),
      stepCode: String(st.step),
      consNumber: cons ? (cons.uploadedAs ? `${cons.consNumber} (subido como ${cons.uploadedAsKind && cons.uploadedAsKind !== (cons.kind === 'f2' ? 'f2' : 'master') ? 'paquete en ' : ''}${cons.uploadedAs})` : cons.consNumber) : null,
      kindLabel: cons ? KIND_LABEL[cons.kind] ?? cons.kind : null,
      receivedAt: cons?.receivedAt ?? null,
      minutesLate: Math.max(1, Math.round((now.getTime() - st.dueAt.getTime()) / 60_000)),
      pct: st.pct,
      progress: cons
        ? {
            total: guides.length || (lifecycle?.unloading.total ?? 0),
            unloaded: guides.filter((g) => g.unloaded).length,
            routed: guides.filter((g) => g.routed).length,
            closed: guides.filter((g) => g.closed).length,
          }
        : null,
      findings,
    };
  }

  /** Las 1–2 personas que más suben consolidados/cargas en la sucursal (últimos 30 días), con nombre y apellido. */
  async usualUploaders(subsidiaryId: string): Promise<string[]> {
    const hit = this.uploaderCache.get(subsidiaryId);
    if (hit) return hit;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows: any[] = await this.ds.query(
      `SELECT TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lastName, ''))) AS name, COUNT(*) AS n
         FROM (SELECT createdById AS uid FROM consolidated WHERE subsidiaryId = ? AND active = 1 AND createdAt >= ?
               UNION ALL
               SELECT createdById FROM charge WHERE subsidiaryId = ? AND createdAt >= ?) x
         JOIN \`user\` u ON u.id = x.uid
        GROUP BY u.id, u.name, u.lastName`,
      [subsidiaryId, since, subsidiaryId, since],
    );
    const names = pickUsualUploaders(rows.map((r) => ({ name: r.name, n: Number(r.n) })));
    this.uploaderCache.set(subsidiaryId, names);
    return names;
  }

  private async notify(
    level: number,
    alert: OpsAlert,
    st: { step: OpsStep | string; dueAt: Date; pct: number },
    cons: InboxConsolidation | null,
    lifecycle: Lifecycle | null,
    now: Date,
    cfg?: OpsAlertSubsidiary,
  ) {
    const block = await this.buildBlock(level, alert.subsidiaryId, st, cons, lifecycle, now);
    const uploaders = await this.usualUploaders(alert.subsidiaryId);
    const title = `${level >= 3 ? '🚨' : '⏰'} ${block.step} pendiente · ${block.subsidiaryName}`;
    const text = buildAlertMessage(block, uploaders);
    const event = {
      type: 'operacion.alertas',
      title,
      body: text.replace(/\*/g, ''),
      severity: (level >= 2 ? 'error' : 'warning') as 'error' | 'warning',
      link: '/correos/seguimiento',
      entityId: alert.inboxConsolidationId ?? undefined,
    };

    // Grupos generales: se juntan y se manda UN mensaje al final de la revisión.
    const settings = await this.getSettings();
    if (level >= (settings.alertGroupsLevel ?? 1)) this.digest.push(block);

    // Cada envío queda en el historial de Correos (origen: alerta, lo manda el sistema).
    const ctx = { origin: 'alerta' as const, sentById: null, sentByName: null, subsidiaryId: alert.subsidiaryId, consNumber: cons?.consNumber ?? null, inboxMessageId: cons?.inboxMessageId ?? null };

    // Nivel 1 en adelante: usuarios de la sucursal (campana).
    const users = await this.subsidiaryUsers(alert.subsidiaryId);
    if (users.length) await this.sendLog.notifyUsers(users, event, ctx, false);

    // Nivel 2: encargados (campana + correo).
    const managers = cfg?.managerUserIds ?? [];
    if (level >= 2 && managers.length) await this.sendLog.notifyUsers(managers, event, ctx, true);

    // Nivel 3: supervisión (campana) + WhatsApp a números y grupos de la sucursal.
    if (level >= 3) {
      const supers: any[] = await this.ds.query("SELECT id FROM `user` WHERE active = 1 AND LOWER(role) IN ('superadmin', 'superamin')");
      if (supers.length) await this.sendLog.notifyUsers(supers.map((u) => u.id), event, ctx, false);
      for (const n of cfg?.whatsappNumbers ?? []) await this.sendLog.whatsappTo({ id: n, name: n }, text, ctx, title);
      for (const g of cfg?.whatsappGroups ?? []) await this.sendLog.whatsappTo(g, text, ctx, title);
    }
  }

  /** Grupos generales de WhatsApp: los elegidos en Configuración o, si no hay, los conocidos por nombre. */
  async generalGroups(): Promise<{ id: string; name: string }[]> {
    const s = await this.getSettings();
    const groups = [...(s.uploadNotifyGroups ?? [])];
    if (!groups.length) {
      for (const name of DEFAULT_UPLOAD_GROUPS) {
        const id = await this.whatsapp.findGroupJid(name).catch(() => null);
        if (id && !groups.some((g) => g.id === id)) groups.push({ id, name });
      }
    }
    return groups;
  }

  private async sendDigest(now: Date, blocks: AlertBlock[] = this.digest, opts: { test?: boolean; sentBy?: { id: string | null; name: string | null } } = {}) {
    const groups = await this.generalGroups();
    if (!groups.length) {
      this.logger.warn('[ops-alerts] alertas a grupos: no hay grupos de WhatsApp elegidos ni encontrados por nombre');
      return { sent: 0, groups: 0 };
    }
    const uploaders = new Map<string, string[]>();
    for (const id of new Set(blocks.map((b) => b.subsidiaryId))) uploaders.set(id, await this.usualUploaders(id));
    const text = buildAlertDigest(blocks, uploaders, now, { test: opts.test });
    const subs = [...new Set(blocks.map((d) => d.subsidiaryName))];
    const ctx = { origin: 'alerta' as const, sentById: opts.sentBy?.id ?? null, sentByName: opts.sentBy?.name ?? null, subsidiaryId: null, consNumber: null };
    const title = `${opts.test ? 'Prueba de alertas' : 'Alertas operativas'} (${blocks.length}) · ${subs.join(', ')}`.slice(0, 255);
    for (const g of groups) await this.sendLog.whatsappTo(g, text, ctx, title);
    return { sent: blocks.length, groups: groups.length, text };
  }

  /**
   * Prueba (SOLO en desarrollo): arma el mensaje de grupos con TODO lo vencido en este momento
   * (aunque ya se haya avisado o venga de antes de encender) y lo manda; en desarrollo llega al
   * número de prueba. No toca el registro de alertas.
   */
  async testDigest(user: { id: string | null; name: string | null }, now = new Date()) {
    if (!devWhatsappRedirect(process.env)) throw new BadRequestException('La prueba de alertas solo se puede usar en desarrollo');
    const s = await this.getSettings();
    this.uploaderCache.clear();
    const cfg = await this.cfgMap();
    const list = await this.recentConsolidations(s, now);
    const lc = await this.lifecycle.forConsolidations(list);
    const blocks: AlertBlock[] = [];
    for (const c of list) {
      for (const st of computeSteps(lc.get(c.id) as Lifecycle, s, this.stepsOf(cfg.get(c.subsidiaryId as string)))) {
        if (st.done) continue;
        const level = alertLevel(st.dueAt, now, s);
        if (level > 0) blocks.push(await this.buildBlock(level, c.subsidiaryId as string, st, c, lc.get(c.id) ?? null, now));
      }
    }
    const day = localDay(now);
    const dueAt = atLocalTime(day, s.inventoryTime);
    for (const subsidiaryId of new Set<string>([...list.map((c) => c.subsidiaryId as string), ...cfg.keys()])) {
      if (!this.stepsOf(cfg.get(subsidiaryId)).inventory || (await this.inventoryDoneAt(subsidiaryId, day))) continue;
      const level = alertLevel(dueAt, now, s);
      if (level > 0) blocks.push(await this.buildBlock(level, subsidiaryId, { step: 'inventory', dueAt, pct: 0 }, null, null, now));
    }
    if (!blocks.length) return { sent: 0, groups: 0, text: null, message: 'No hay nada vencido en este momento' };
    return this.sendDigest(now, blocks, { test: true, sentBy: user });
  }

  /** Alertas abiertas (para pantallas), limitadas a las sucursales visibles. */
  async openAlerts(scope: string[] | null) {
    const where: any = { resolvedAt: IsNull() };
    if (scope !== null) where.subsidiaryId = In(scope.length ? scope : ['-']);
    return this.alertRepo.find({ where, order: { dueAt: 'ASC' }, take: 300 });
  }

  /** Recorrido de los consolidados de un correo. */
  async trackingForMessage(messageId: string) {
    return this.tracking(await this.consRepo.find({ where: { inboxMessageId: messageId, linkStatus: Not('no_aplica') } }));
  }

  /** Recorrido de los consolidados recibidos en un rango (pestaña Seguimiento). */
  async trackingForRange(from: Date, to: Date, scope: string[] | null, subsidiaryId?: string) {
    const qb = this.consRepo
      .createQueryBuilder('c')
      .where('c.receivedAt >= :from AND c.receivedAt < :to', { from, to })
      .andWhere("c.linkStatus <> 'no_aplica'")
      .andWhere('c.subsidiaryId IS NOT NULL');
    if (scope !== null) qb.andWhere(scope.length ? 'c.subsidiaryId IN (:...scope)' : '1 = 0', { scope });
    if (subsidiaryId) qb.andWhere('c.subsidiaryId = :sid', { sid: subsidiaryId });
    return this.tracking(await qb.orderBy('c.receivedAt', 'DESC').getMany());
  }
}
