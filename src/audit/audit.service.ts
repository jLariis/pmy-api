import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { AuditLog } from 'src/entities/audit-log.entity';
import { User } from 'src/entities/user.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditAction, AuditResult } from 'src/common/enums/audit.enum';
import { parseDevice, geoFromIp } from './client-info.util';

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private buffer: CreateAuditLogDto[] = [];
  private flushing = false;
  private readonly timer: NodeJS.Timeout;

  /**
   * Presencia "en línea" en memoria. Se actualiza en CADA request autenticado
   * (incluye GET), sin escribir en audit_log. Nota: es por instancia y se
   * reinicia al reiniciar el API (suficiente para "quién está conectado ahora").
   */
  private presence = new Map<string, {
    userId: string; userEmail?: string; userName?: string; role?: string; subsidiaryId?: string;
    ip?: string; userAgent?: string; loginAt: Date; lastSeenAt: Date; lastPath?: string; eventsCount: number;
    publicIp?: string; geoCity?: string; geoRegion?: string; geoCountry?: string; device?: string; deviceId?: string;
  }>();

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
  ) {
    this.timer = setInterval(() => void this.flush(), 3000);
    this.timer.unref?.();
  }

  /** Fire-and-forget: NUNCA lanza ni bloquea la operación de negocio. */
  log(entry: CreateAuditLogDto): void {
    try {
      this.buffer.push({ ...entry, result: entry.result ?? AuditResult.SUCCESS });
      if (this.buffer.length >= 50) void this.flush();
    } catch (e) {
      this.logger.error(`audit.log buffer error: ${e.message}`);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.repo.insert(batch as any);
    } catch (e) {
      this.logger.error(`audit flush error (${batch.length} regs): ${e.message}`);
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flush();
  }

  // ============================ CONSULTAS ============================

  /** Cache simple (id→nombre de sucursal) para resolver nombres sin joins por fila. */
  private subNameCache: { at: number; map: Map<string, string> } | null = null;

  private async getSubsidiaryNameMap(): Promise<Map<string, string>> {
    if (this.subNameCache && Date.now() - this.subNameCache.at < 60000) {
      return this.subNameCache.map;
    }
    const map = new Map<string, string>();
    try {
      const subs = await this.subsidiaryRepo.find({ select: ['id', 'name'] as any });
      for (const s of subs) map.set(s.id, s.name);
    } catch (e) {
      this.logger.warn(`audit.getSubsidiaryNameMap degradado: ${e.message}`);
    }
    this.subNameCache = { at: Date.now(), map };
    return map;
  }

  /** Agrega `subsidiaryName` (nombre real) a cada fila a partir de su `subsidiaryId`. */
  private async withSubsidiaryName<T extends { subsidiaryId?: string }>(rows: T[]): Promise<T[]> {
    if (!rows?.length) return rows;
    const map = await this.getSubsidiaryNameMap();
    for (const r of rows) {
      (r as any).subsidiaryName = r.subsidiaryId ? map.get(r.subsidiaryId) ?? null : null;
    }
    return rows;
  }

  async findAll(q: QueryAuditLogDto) {
   try {
    const where: FindOptionsWhere<AuditLog> = {};
    if (q.userId) where.userId = q.userId;
    if (q.module) where.module = q.module;
    if (q.action) where.action = q.action;
    if (q.result) where.result = q.result;
    if (q.entityName) where.entityName = q.entityName;
    if (q.entityId) where.entityId = q.entityId;
    if (q.subsidiaryId) where.subsidiaryId = q.subsidiaryId;
    if (q.dateFrom && q.dateTo) {
      where.createdAt = Between(new Date(q.dateFrom), new Date(q.dateTo));
    }

    const sortable = ['createdAt', 'module', 'action', 'result', 'userEmail'];
    const sortBy = sortable.includes(q.sortBy) ? q.sortBy : 'createdAt';

    const qb = this.repo.createQueryBuilder('a').where(where);
    if (q.search) {
      qb.andWhere(
        '(a.description LIKE :s OR a.userEmail LIKE :s OR a.path LIKE :s OR a.entityId LIKE :s)',
        { s: `%${q.search}%` },
      );
    }

    const [data, total] = await qb
      .orderBy(`a.${sortBy}`, q.order)
      .skip((q.page - 1) * q.limit)
      .take(q.limit)
      .getManyAndCount();

    await this.withSubsidiaryName(data);

    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) };
   } catch (e) {
      this.logger.warn(`audit.findAll degradado: ${e.message}`);
      return { data: [], total: 0, page: q.page, limit: q.limit, totalPages: 0 };
   }
  }

  async findByModule(module: string, limit = 20) {
    try {
      return await this.repo.find({
        where: { module: module as any },
        order: { createdAt: 'DESC' },
        take: limit,
      });
    } catch (e) {
      this.logger.warn(`audit.findByModule degradado: ${e.message}`);
      return [];
    }
  }

  async findByUser(userId: string, limit = 20) {
    try {
      return await this.repo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: limit,
      });
    } catch (e) {
      this.logger.warn(`audit.findByUser degradado: ${e.message}`);
      return [];
    }
  }

  // ====================== USUARIOS (lista + detalle) ======================

  /** Lista de usuarios del sistema + estadísticas de auditoría y estado en línea. */
  async getUsers() {
    try {
      const users = await this.userRepo.find({ relations: ['subsidiary'] });
      const stats = await this.repo
        .createQueryBuilder('a')
        .select('a.userId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .addSelect('MAX(a.createdAt)', 'lastActivityAt')
        .where('a.userId IS NOT NULL')
        .groupBy('a.userId')
        .getRawMany();
      const map = new Map(stats.map((s) => [s.userId, s]));

      return users
        .map((u) => ({
          id: u.id,
          name: [u.name, u.lastName].filter(Boolean).join(' ') || u.email,
          email: u.email,
          role: u.role,
          active: u.active,
          subsidiary: u.subsidiary?.name,
          subsidiaryId: u.subsidiary?.id,
          eventCount: Number(map.get(u.id)?.count ?? 0),
          lastActivityAt: map.get(u.id)?.lastActivityAt ?? null,
          online: this.presence.has(u.id),
        }))
        .sort(
          (a, b) =>
            (b.lastActivityAt ? +new Date(b.lastActivityAt) : 0) -
            (a.lastActivityAt ? +new Date(a.lastActivityAt) : 0),
        );
    } catch (e) {
      this.logger.warn(`audit.getUsers degradado: ${e.message}`);
      return [];
    }
  }

  /** Detalle completo de un usuario: stats, acciones, módulos, dispositivos, ubicaciones, IPs, sesiones y eventos recientes. */
  async getUserDetail(userId: string, dateFrom?: Date, dateTo?: Date) {
    // 1) Datos del usuario (independiente de los agregados, para que el header siempre salga).
    let userInfo: any = { id: userId, name: 'Usuario' };
    try {
      const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['subsidiary'] });
      if (user) {
        userInfo = {
          id: user.id,
          name: [user.name, user.lastName].filter(Boolean).join(' ') || user.email,
          email: user.email,
          role: user.role,
          active: user.active,
          subsidiary: user.subsidiary?.name,
          createdAt: user.createdAt,
        };
      }
    } catch (e) {
      this.logger.warn(`audit.getUserDetail (user) degradado: ${e.message}`);
    }

    const online = this.presence.has(userId);
    const empty = {
      user: userInfo, online,
      totals: { total: 0, errors: 0, errorRate: 0 },
      byAction: [], byModule: [], devices: [], locations: [], ips: [], recent: [], sessions: [],
    };

    // 2) Agregados de auditoría (best-effort).
    try {
      const ranged = !!(dateFrom && dateTo);
      const applyRange = (qb: any): any => {
        qb.where('a.userId = :userId', { userId });
        if (ranged) qb.andWhere('a.createdAt BETWEEN :f AND :t', { f: dateFrom, t: dateTo });
        return qb;
      };
      const whereBase: any = { userId };
      if (ranged) whereBase.createdAt = Between(dateFrom as Date, dateTo as Date);

      const [total, errors, byAction, byModule, devices, locations, ips, recent, sessions] =
        await Promise.all([
          this.repo.count({ where: whereBase }),
          this.repo.count({ where: { ...whereBase, result: AuditResult.ERROR } }),
          applyRange(this.repo.createQueryBuilder('a'))
            .select('a.action', 'action').addSelect('COUNT(*)', 'count')
            .groupBy('a.action').orderBy('count', 'DESC').getRawMany(),
          applyRange(this.repo.createQueryBuilder('a'))
            .select('a.module', 'module').addSelect('COUNT(*)', 'count')
            .groupBy('a.module').orderBy('count', 'DESC').getRawMany(),
          applyRange(this.repo.createQueryBuilder('a'))
            .select('a.device', 'device').addSelect('COUNT(*)', 'count').addSelect('MAX(a.createdAt)', 'lastSeen')
            .andWhere('a.device IS NOT NULL').groupBy('a.device').orderBy('count', 'DESC').getRawMany(),
          applyRange(this.repo.createQueryBuilder('a'))
            .select('a.geoCity', 'city').addSelect('a.geoCountry', 'country').addSelect('COUNT(*)', 'count').addSelect('MAX(a.createdAt)', 'lastSeen')
            .andWhere('a.geoCity IS NOT NULL').groupBy('a.geoCity').addGroupBy('a.geoCountry').orderBy('count', 'DESC').getRawMany(),
          // GROUP BY por la EXPRESIÓN (no el alias) para no romper only_full_group_by.
          applyRange(this.repo.createQueryBuilder('a'))
            .select('COALESCE(a.publicIp, a.ip)', 'ip').addSelect('COUNT(*)', 'count').addSelect('MAX(a.createdAt)', 'lastSeen')
            .groupBy('COALESCE(a.publicIp, a.ip)').orderBy('count', 'DESC').limit(15).getRawMany(),
          applyRange(this.repo.createQueryBuilder('a'))
            .orderBy('a.createdAt', 'DESC').limit(50).getMany(),
          applyRange(this.repo.createQueryBuilder('a'))
            .andWhere("a.module = 'auth'").orderBy('a.createdAt', 'DESC').limit(40).getMany(),
        ]);

      await this.withSubsidiaryName(recent);

      return {
        user: userInfo,
        online,
        totals: { total, errors, errorRate: total ? +((errors / total) * 100).toFixed(2) : 0 },
        byAction, byModule, devices, locations, ips, recent, sessions,
      };
    } catch (e) {
      this.logger.warn(`audit.getUserDetail (stats) degradado: ${e.message}`);
      return empty;
    }
  }

  // ====================== INACTIVIDAD POR SUCURSAL ======================

  /**
   * Operaciones vigiladas. Se leen de la TABLA REAL de cada operación (no del
   * audit_log) para tener todo el histórico: `table` con su columna de sucursal
   * (`subCol`) y la fecha de registro (`dateCol`). Los nombres son constantes
   * del propio código (no hay inyección de SQL).
   */
  private static readonly TRACKED_OPERATIONS: {
    key: string; label: string; table: string; subCol: string; dateCol: string;
    /** Columna con el id del usuario que lo creó (si la tabla la tiene). */
    userCol?: string;
    /** Columna a mostrar como etiqueta del registro (folio, guía, categoría…). */
    labelCol?: string;
  }[] = [
    { key: 'consolidados', label: 'Consolidados', table: 'consolidated', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'consNumber' },
    { key: 'desembarques', label: 'Desembarques', table: 'unloading', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'trackingNumber' },
    { key: 'salidas_ruta', label: 'Salidas a ruta', table: 'package_dispatch', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'trackingNumber' },
    { key: 'cierre_ruta', label: 'Cierres de ruta', table: 'route_closure', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById' },
    { key: 'inventarios', label: 'Inventarios', table: 'inventory', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'trackingNumber' },
    { key: 'devoluciones', label: 'Devoluciones', table: 'devolution', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'trackingNumber' },
    { key: 'recolecciones', label: 'Recolecciones', table: 'collection', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'trackingNumber' },
    { key: 'traslados', label: 'Traslados', table: 'transfer', subCol: 'originId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'transferType' },
    { key: 'gastos', label: 'Gastos', table: 'expense', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'category' },
    { key: 'ingresos', label: 'Ingresos', table: 'income', subCol: 'subsidiaryId', dateCol: 'createdAt', userCol: 'createdById', labelCol: 'trackingNumber' },
  ];

  /**
   * Inactividad por sucursal: por cada sucursal y operación clave, la ÚLTIMA vez
   * que se realizó (y hace cuántos días). Para detectar sucursales que dejaron de
   * subir consolidados, hacer desembarques, registrar gastos, etc.
   *
   * Lee directamente la tabla de cada operación (histórico completo), no el
   * audit_log. Cada consulta es best-effort: si una tabla falla, esa operación
   * queda en blanco sin tumbar el resto.
   */
  async getSubsidiariesActivity() {
    const OPS = AuditService.TRACKED_OPERATIONS;
    const modules = OPS.map((o) => ({ key: o.key, label: o.label }));
    try {
      const subsidiaries = await this.subsidiaryRepo.find({
        where: { active: true } as any,
        order: { name: 'ASC' },
      });

      // op.key -> (subsidiaryId -> { last, total })
      const byOp = new Map<string, Map<string, { last: string; total: number }>>();
      await Promise.all(
        OPS.map(async (op) => {
          const m = new Map<string, { last: string; total: number }>();
          byOp.set(op.key, m);
          try {
            // DATE_FORMAT(...Z): la BD guarda en UTC (timezone:"Z"); devolvemos ISO-UTC
            // explícito para que el frontend lo muestre en la zona local del usuario.
            const sql =
              `SELECT \`${op.subCol}\` AS sid, DATE_FORMAT(MAX(\`${op.dateCol}\`), '%Y-%m-%dT%H:%i:%sZ') AS last, COUNT(*) AS total ` +
              `FROM \`${op.table}\` WHERE \`${op.subCol}\` IS NOT NULL GROUP BY \`${op.subCol}\``;
            const rows: any[] = await this.repo.manager.query(sql);
            for (const r of rows) m.set(String(r.sid), { last: r.last, total: Number(r.total) });
          } catch (err: any) {
            this.logger.warn(`subsidiariesActivity[${op.key}] degradado: ${err.message}`);
          }
        }),
      );

      const now = Date.now();
      const daysSince = (d?: string | null): number | null =>
        d ? Math.floor((now - new Date(d).getTime()) / 86400000) : null;

      const subsidiariesOut = subsidiaries.map((s) => {
        const operations = OPS.map((op) => {
          const hit = byOp.get(op.key)?.get(s.id);
          return {
            module: op.key,
            label: op.label,
            lastAt: hit?.last ?? null,
            daysSince: daysSince(hit?.last),
            total: hit?.total ?? 0,
          };
        });
        const everDone = operations.filter((o) => o.lastAt);
        const worstDays = everDone.length ? Math.max(...everDone.map((o) => o.daysSince ?? 0)) : null;
        const neverCount = operations.filter((o) => !o.lastAt).length;
        const lastAnyAt = everDone.length
          ? everDone.reduce((a, b) => (new Date(a.lastAt as string) > new Date(b.lastAt as string) ? a : b)).lastAt
          : null;
        return { id: s.id, name: s.name, operations, worstDays, neverCount, lastAnyAt };
      });

      return { generatedAt: new Date().toISOString(), modules, subsidiaries: subsidiariesOut };
    } catch (e) {
      this.logger.warn(`audit.getSubsidiariesActivity degradado: ${e.message}`);
      return { generatedAt: new Date().toISOString(), modules, subsidiaries: [] };
    }
  }

  /**
   * Detalle de una sucursal: por cada operación, los últimos `perOp` registros
   * (quién lo hizo, cuándo y su folio/guía). Lee las tablas reales; cada consulta
   * es best-effort. Devoluciones/recolecciones/ingresos no guardan el usuario
   * creador en su tabla, así que ahí el autor sale vacío.
   */
  async getSubsidiaryRecent(subsidiaryId: string, perOp = 6) {
    const OPS = AuditService.TRACKED_OPERATIONS;
    const limit = Math.min(Math.max(Number(perOp) || 6, 1), 20);
    let name: string | undefined;
    try {
      const sub = await this.subsidiaryRepo.findOne({ where: { id: subsidiaryId } });
      name = sub?.name;
    } catch { /* ignore */ }

    try {
      const operations = await Promise.all(
        OPS.map(async (op) => {
          try {
            const labelSel = op.labelCol ? `t.\`${op.labelCol}\`` : 'NULL';
            const join = op.userCol ? `LEFT JOIN \`user\` u ON u.id = t.\`${op.userCol}\`` : '';
            const userSel = op.userCol ? 'u.name AS uName, u.lastName AS uLast, u.email AS uEmail' : 'NULL AS uName, NULL AS uLast, NULL AS uEmail';
            const sql =
              `SELECT DATE_FORMAT(t.\`${op.dateCol}\`, '%Y-%m-%dT%H:%i:%sZ') AS date, ${labelSel} AS label, ${userSel} ` +
              `FROM \`${op.table}\` t ${join} ` +
              `WHERE t.\`${op.subCol}\` = ? ORDER BY t.\`${op.dateCol}\` DESC LIMIT ${limit}`;
            const rows: any[] = await this.repo.manager.query(sql, [subsidiaryId]);
            return {
              module: op.key,
              label: op.label,
              hasUser: !!op.userCol,
              items: rows.map((r) => ({
                date: r.date,
                label: r.label != null && r.label !== '' ? String(r.label) : null,
                user: [r.uName, r.uLast].filter(Boolean).join(' ') || r.uEmail || null,
              })),
            };
          } catch (err: any) {
            this.logger.warn(`subsidiaryRecent[${op.key}] degradado: ${err.message}`);
            return { module: op.key, label: op.label, hasUser: !!op.userCol, items: [] };
          }
        }),
      );
      return { id: subsidiaryId, name, operations };
    } catch (e) {
      this.logger.warn(`audit.getSubsidiaryRecent degradado: ${e.message}`);
      return { id: subsidiaryId, name, operations: [] };
    }
  }

  // ====================== PRESENCIA / USUARIOS EN LÍNEA ======================

  /**
   * Registra/actualiza la presencia de un usuario. Lo llama el interceptor en
   * CADA request autenticado. `isLogin` arranca una sesión nueva (resetea loginAt/ip).
   */
  touchPresence(
    user: any,
    ip: string,
    userAgent: string,
    path: string,
    opts?: {
      isLogin?: boolean;
      publicIp?: string; geoCity?: string; geoRegion?: string; geoCountry?: string;
      device?: string; deviceId?: string;
    },
  ): void {
    const id = user?.userId ?? user?.id;
    if (!id) return;
    const now = new Date();
    const existing = this.presence.get(id);

    if (!existing || opts?.isLogin) {
      this.presence.set(id, {
        userId: id,
        userEmail: user.email,
        userName: [user.name, user.lastName].filter(Boolean).join(' ') || undefined,
        role: user.role,
        subsidiaryId: user.subsidiary?.id ?? user.subsidiaryId,
        ip,
        userAgent,
        loginAt: now,
        lastSeenAt: now,
        lastPath: path,
        eventsCount: 1,
        publicIp: opts?.publicIp,
        geoCity: opts?.geoCity,
        geoRegion: opts?.geoRegion,
        geoCountry: opts?.geoCountry,
        device: opts?.device,
        deviceId: opts?.deviceId,
      });
      return;
    }

    existing.lastSeenAt = now;
    existing.lastPath = path;
    existing.eventsCount++;
    if (ip) existing.ip = ip;
    if (userAgent) existing.userAgent = userAgent;
    if (user.email && !existing.userEmail) existing.userEmail = user.email;
    if (user.role && !existing.role) existing.role = user.role;
    // Actualiza geo/device si llegan datos nuevos (no pisar con vacío).
    if (opts?.publicIp) existing.publicIp = opts.publicIp;
    if (opts?.geoCity) existing.geoCity = opts.geoCity;
    if (opts?.geoRegion) existing.geoRegion = opts.geoRegion;
    if (opts?.geoCountry) existing.geoCountry = opts.geoCountry;
    if (opts?.device) existing.device = opts.device;
    if (opts?.deviceId) existing.deviceId = opts.deviceId;
  }

  /** Cierra la sesión de presencia (logout). */
  endPresence(userId: string): void {
    if (userId) this.presence.delete(userId);
  }

  /**
   * Usuarios "en línea": los que tuvieron actividad (cualquier request) dentro
   * de la ventana. Incluye hora de login, IP, último visto y conteo de acciones.
   */
  getActiveUsers(windowMinutes = 15) {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const users = Array.from(this.presence.values())
      .filter((p) => p.lastSeenAt.getTime() >= cutoff)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map((p) => ({
        userId: p.userId,
        userEmail: p.userEmail,
        userName: p.userName,
        role: p.role,
        subsidiaryId: p.subsidiaryId,
        ip: p.ip,
        publicIp: p.publicIp,
        userAgent: p.userAgent,
        device: p.device || parseDevice(p.userAgent),
        deviceId: p.deviceId,
        location:
          [p.geoCity, p.geoRegion, p.geoCountry].filter(Boolean).join(', ') ||
          geoFromIp(p.ip) ||
          undefined,
        loginAt: p.loginAt,
        lastActivityAt: p.lastSeenAt,
        lastPath: p.lastPath,
        eventsInWindow: p.eventsCount,
      }));

    // Limpieza pasiva de entradas viejas para no crecer sin límite.
    for (const [id, p] of this.presence) {
      if (p.lastSeenAt.getTime() < cutoff - 60 * 60 * 1000) this.presence.delete(id);
    }

    return { windowMinutes, count: users.length, users };
  }

  // ============================ DASHBOARD ============================

  async dashboard(dateFrom: Date, dateTo: Date) {
   try {
    const range = Between(dateFrom, dateTo);
    const [total, errors, activeUsers, byModule, byUser, byAction, timeline, topDevices, topLocations] = await Promise.all([
      this.repo.count({ where: { createdAt: range } }),
      this.repo.count({ where: { createdAt: range, result: AuditResult.ERROR } }),
      this.repo
        .createQueryBuilder('a')
        .select('COUNT(DISTINCT a.userId)', 'count')
        .where({ createdAt: range })
        .getRawOne(),
      this.repo
        .createQueryBuilder('a')
        .select('a.module', 'module')
        .addSelect('COUNT(*)', 'count')
        .where({ createdAt: range })
        .groupBy('a.module')
        .orderBy('count', 'DESC')
        .getRawMany(),
      this.repo
        .createQueryBuilder('a')
        .select('a.userId', 'userId')
        .addSelect('a.userEmail', 'email')
        .addSelect('COUNT(*)', 'count')
        .where({ createdAt: range })
        .andWhere('a.userId IS NOT NULL')
        .groupBy('a.userId')
        .addGroupBy('a.userEmail')
        .orderBy('count', 'DESC')
        .limit(10)
        .getRawMany(),
      this.repo
        .createQueryBuilder('a')
        .select('a.action', 'action')
        .addSelect('COUNT(*)', 'count')
        .where({ createdAt: range })
        .groupBy('a.action')
        .orderBy('count', 'DESC')
        .getRawMany(),
      this.repo
        .createQueryBuilder('a')
        .select('DATE(a.createdAt)', 'day')
        .addSelect('COUNT(*)', 'count')
        .where({ createdAt: range })
        .groupBy('day')
        .orderBy('day', 'ASC')
        .getRawMany(),
      this.repo
        .createQueryBuilder('a')
        .select('a.device', 'device')
        .addSelect('COUNT(*)', 'count')
        .where({ createdAt: range })
        .andWhere('a.device IS NOT NULL')
        .groupBy('a.device')
        .orderBy('count', 'DESC')
        .limit(8)
        .getRawMany(),
      this.repo
        .createQueryBuilder('a')
        .select('a.geoCity', 'city')
        .addSelect('a.geoCountry', 'country')
        .addSelect('COUNT(*)', 'count')
        .where({ createdAt: range })
        .andWhere('a.geoCity IS NOT NULL')
        .groupBy('a.geoCity')
        .addGroupBy('a.geoCountry')
        .orderBy('count', 'DESC')
        .limit(8)
        .getRawMany(),
    ]);

    return {
      totals: {
        total,
        errors,
        activeUsers: Number(activeUsers?.count ?? 0),
        errorRate: total ? +((errors / total) * 100).toFixed(2) : 0,
      },
      topModules: byModule,
      topUsers: byUser,
      byAction,
      timeline,
      topDevices,
      topLocations,
    };
   } catch (e) {
      this.logger.warn(`audit.dashboard degradado: ${e.message}`);
      return {
        totals: { total: 0, errors: 0, activeUsers: 0, errorRate: 0 },
        topModules: [],
        topUsers: [],
        byAction: [],
        timeline: [],
        topDevices: [],
        topLocations: [],
      };
   }
  }

  // ===================== DETECCIÓN DE SOSPECHOSOS =====================

  async detectSuspicious(dateFrom: Date, dateTo: Date) {
   try {
    const range = Between(dateFrom, dateTo);

    const failedLogins = await this.repo
      .createQueryBuilder('a')
      .select('a.userEmail', 'email')
      .addSelect('a.ip', 'ip')
      .addSelect('COUNT(*)', 'count')
      .where({ createdAt: range })
      .andWhere('(a.action = :failed OR (a.action = :login AND a.result = :err))', {
        failed: AuditAction.LOGIN_FAILED,
        login: AuditAction.LOGIN,
        err: AuditResult.ERROR,
      })
      .groupBy('a.userEmail')
      .addGroupBy('a.ip')
      .having('COUNT(*) >= 5')
      .orderBy('count', 'DESC')
      .getRawMany();

    const bulkDeletes = await this.repo
      .createQueryBuilder('a')
      .select('a.userEmail', 'email')
      .addSelect('COUNT(*)', 'count')
      .where({ createdAt: range, action: AuditAction.DELETE })
      .groupBy('a.userEmail')
      .having('COUNT(*) >= 20')
      .orderBy('count', 'DESC')
      .getRawMany();

    const offHours = await this.repo
      .createQueryBuilder('a')
      .select('a.userEmail', 'email')
      .addSelect('COUNT(*)', 'count')
      .where({ createdAt: range })
      .andWhere('HOUR(a.createdAt) BETWEEN 0 AND 5')
      .groupBy('a.userEmail')
      .having('COUNT(*) >= 10')
      .orderBy('count', 'DESC')
      .getRawMany();

    const highErrorUsers = await this.repo
      .createQueryBuilder('a')
      .select('a.userEmail', 'email')
      .addSelect('COUNT(*)', 'errors')
      .where({ createdAt: range, result: AuditResult.ERROR })
      .andWhere('a.userId IS NOT NULL')
      .groupBy('a.userEmail')
      .having('COUNT(*) >= 30')
      .orderBy('errors', 'DESC')
      .getRawMany();

    const massExports = await this.repo
      .createQueryBuilder('a')
      .select('a.userEmail', 'email')
      .addSelect('COUNT(*)', 'count')
      .where({ createdAt: range, action: AuditAction.EXPORT })
      .groupBy('a.userEmail')
      .having('COUNT(*) >= 10')
      .orderBy('count', 'DESC')
      .getRawMany();

    const multiIp = await this.repo
      .createQueryBuilder('a')
      .select('a.userEmail', 'email')
      .addSelect('COUNT(DISTINCT a.ip)', 'ips')
      .where({ createdAt: range })
      .andWhere('a.userId IS NOT NULL')
      .groupBy('a.userEmail')
      .having('COUNT(DISTINCT a.ip) >= 4')
      .orderBy('ips', 'DESC')
      .getRawMany();

    return { failedLogins, bulkDeletes, offHours, highErrorUsers, massExports, multiIp };
   } catch (e) {
      this.logger.warn(`audit.detectSuspicious degradado: ${e.message}`);
      return { failedLogins: [], bulkDeletes: [], offHours: [], highErrorUsers: [], massExports: [], multiIp: [] };
   }
  }

  /** Mismo filtro que findAll pero sin paginar (con tope de seguridad) para exportar. */
  async findForExport(q: QueryAuditLogDto, max = 50000) {
    const { data } = await this.findAll({ ...q, page: 1, limit: max });
    return data;
  }
}
