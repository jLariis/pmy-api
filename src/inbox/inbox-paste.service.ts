import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { workbookSheets } from './attachment-classify.util';
import { buildPastePlan, expandWorkbook, PasteBatch, PasteBatchKind, PlanAttachment, tsvTrackings, unmatchedCobros, WorkbookSheet } from './paste-plan.util';
import { uploadMinutes } from './zip-coverage.util';
import { WhatsappGatewayService } from '../whatsapp-gateway/whatsapp-gateway.service';
import { buildUploadMessage, DEFAULT_UPLOAD_GROUPS, UploadSummary } from './upload-message.util';
import { MatchGroup } from './system-match.util';
import { buildConsNumber, detectRoutePattern, routeOf, RoutePattern } from './route-cons.util';
import { ConsolidationKind } from './inbox.types';
import { familyKey } from '../approvals/consolidated-family.loader';
import { SendLogService } from '../ops-alerts/send-log.service';

const TSV_KINDS = ['master', 'master_aereo', 'f2', 'high_value'];

export interface PlanBatchView extends PasteBatch {
  hvCount: number;
  cobrosCount: number;
  /** Ya está en el sistema (por esta bandeja o subido por otro camino). */
  uploaded: { at: Date; byName: string | null; minutes: number | null; via: string | null } | null;
  /** F2: guías de este bloque que ya se subieron como paquete en el master de ESTE mismo correo. */
  alreadyInMaster?: { count: number; consNumber: string };
  /** Revisión por guías: cuántas del bloque ya están en el sistema y en qué consolidados. */
  inSystem: { found: number; total: number; complete: boolean; groups: MatchGroup[] } | null;
  /** El número se armó con el formato de la sucursal (fecha+ruta o ruta+fecha); revisar antes de subir. */
  consSuggested?: { pattern: RoutePattern; route: string } | null;
  /** Las guías del bloque están subidas con el OTRO tipo (F2 como paquete o master como carga). */
  typeMismatch?: TypeMismatch | null;
}

/** Guías del correo subidas con el tipo equivocado → lo que hace falta para pedir "Cambiar tipo". */
export interface TypeMismatch {
  toType: 'carga' | 'paquete';
  consolidatedId: string;
  consNumber: string;
  subsidiaryName: string;
  count: number;
  trackingNumbers: string[];
  /** Son TODAS las guías de ese consolidado con ese tipo (se pide el cambio completo). */
  whole: boolean;
  /** Consolidado donde esas guías ya están con el tipo correcto (si existe). */
  targetConsolidatedId: string | null;
  targetConsNumber: string | null;
  /** Número de FedEx del bloque del correo (para crear el destino si no existe). */
  emailConsNumber: string | null;
  /** Ya hay una solicitud pendiente para ese consolidado. */
  pending: boolean;
}

export interface PastePlanResult {
  /** Se puede mandar sin otra confirmación (sucursal confirmada o detectada segura). */
  ready: boolean;
  reason: string | null;
  batches: PlanBatchView[];
  /** Guías de cobros del correo que no están en ningún archivo (no se pueden aplicar). */
  unmatchedCobros: string[];
  /** Consolidados que el correo anuncia pero sin archivo adjunto (p. ej. COD, F2 o HV solo en el texto). */
  announcedOnly: {
    consNumber: string;
    kind: string;
    announcedCount: number | null;
    /** Hoja del libro master donde ya vienen ("COD" / "HV"); null = no vino archivo. */
    insideSheet: string | null;
    uploaded: { at: Date; byName: string | null; minutes: number | null } | null;
  }[];
}

/**
 * Bandeja → "Pegar FedEx": arma los lotes del correo para abrir el pegado ya lleno
 * y registra cuando se mandó (el tablero lo muestra como "subido desde correo").
 */
@Injectable()
export class InboxPasteService {
  constructor(
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly ds: DataSource,
    private readonly whatsapp: WhatsappGatewayService,
    private readonly sendLog: SendLogService,
  ) {}

  private readonly logger = new Logger(InboxPasteService.name);

  async plan(messageId: string): Promise<PastePlanResult> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('No se encontró ese correo');
    const atts = await this.attRepo.find({ where: { inboxMessageId: messageId } });
    const cons = await this.consRepo.find({ where: { inboxMessageId: messageId } });

    // Cada libro se reparte por hojas (YAQUI / F2 / COD / HV) antes de armar los bloques.
    const planAtts: PlanAttachment[] = [];
    const sheetRoles = new Set<string>();
    let extraPayments = '';
    for (const a of atts) {
      if (!TSV_KINDS.includes(a.kind)) continue;
      let sheets: WorkbookSheet[] = [];
      try {
        sheets = workbookSheets(await fs.readFile(join(process.cwd(), a.storagePath)));
      } catch {
        sheets = [];
      }
      const ex = expandWorkbook({ id: a.id, filename: a.filename, kind: a.kind, consNumber: a.consNumber }, sheets);
      planAtts.push(...ex.units);
      ex.roles.forEach((r) => sheetRoles.add(r));
      if (ex.extraPayments) extraPayments = [extraPayments, ex.extraPayments].filter(Boolean).join('\n');
    }

    const legacyKey = (a: InboxAttachment) => `${a.kind === 'master_aereo' ? 'aereo' : a.kind === 'high_value' ? 'master' : a.kind}:${a.id}`;
    const batches = buildPastePlan({
      subsidiaryId: msg.subsidiaryId,
      receivedAt: msg.receivedAt,
      attachments: planAtts,
      announced: cons.map((c) => ({ consNumber: c.consNumber, kind: c.kind })),
      cobros: cons.flatMap((c) => c.cobros ?? []),
      doneKeys: atts.flatMap((a) => [...(a.pastedKeys ?? []), ...(a.pastedAt && !a.pastedKeys?.length ? [legacyKey(a)] : [])]),
      extraPaymentsRaw: extraPayments,
    });

    const userIds = [...new Set(cons.map((c) => c.uploadedById).filter((x): x is string => !!x))];
    const users: { id: string; name: string | null; lastName: string | null }[] = userIds.length
      ? await this.ds.query(`SELECT id, name, lastName FROM \`user\` WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds)
      : [];
    const nameOf = (id: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? [u.name, u.lastName].filter(Boolean).join(' ') : null;
    };
    const consKind = (k: PasteBatchKind) => (k === 'aereo' ? 'aereo' : k === 'f2' ? 'f2' : 'master');
    const elsewhere = await this.activeInOtherSubsidiary(batches.map((b) => b.consNumber).filter(Boolean), msg.subsidiaryId);
    const sentFrom = await this.alreadySentFromOtherEmail(atts, messageId);
    const f2InMaster = await this.f2GuidesAlreadyInEmailMaster(batches);
    const routePattern = await this.routePatternOf(msg.subsidiaryId);
    const announcedF2 = new Set(cons.filter((c) => c.kind === 'f2').map((c) => c.consNumber.trim()));
    const mismatches = await this.typeMismatches(batches, msg.receivedAt, announcedF2);
    const views: PlanBatchView[] = batches.map((b) => {
      const c = b.consNumber
        ? cons.find((x) => x.consNumber === b.consNumber && x.kind === consKind(b.kind) && x.linkStatus === 'subido')
        : undefined;
      // Candados previos a subir (no esperar al error del guardado):
      //  · el consolidado ya está activo en OTRA sucursal (el backend también lo bloquea);
      //  · el mismo archivo ya se subió desde otro correo (reenvíos).
      const other = b.consNumber ? elsewhere.get(b.consNumber) : undefined;
      const resent = sentFrom.get(b.attachmentId);
      const lock = other
        ? `Ya está subido en ${other.subsidiaryName}${other.byName ? ` por ${other.byName}` : ''} (${other.at.toLocaleString('es-MX', { timeZone: 'America/Hermosillo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}). Si va en esta sucursal, primero hay que moverlo desde Consolidados.`
        : resent && !c
          ? `Este mismo archivo ya se subió desde el correo "${resent}".`
          : null;
      // Revisión por guías (sirve aunque la sucursal suba con un número propio que el correo no trae).
      const sm = atts.find((a) => a.id === b.attachmentId)?.systemMatch?.[b.sheet ?? '_'] ?? null;
      // Rutas locales sin número: se arma con el formato que usa la sucursal (p. ej. Hermosillo 071026364).
      const route = b.consNumber ? null : routeOf(b.sheet ?? b.filename.replace(/ · hoja ".*"$/, ''));
      const suggested = route && routePattern ? { pattern: routePattern, route, consNumber: buildConsNumber(routePattern, route, b.consDate) } : null;
      const top = sm?.groups?.[0];
      const byGuides =
        !c && sm?.complete && top
          ? { at: new Date(top.at), byName: top.byName, minutes: uploadMinutes(msg.receivedAt, new Date(top.at)), via: 'manual' as string | null }
          : null;
      return {
        ...b,
        consNumber: b.consNumber || (sm?.complete && top && top.consNumber !== '(sin número)' ? top.consNumber : suggested?.consNumber ?? b.consNumber),
        consSuggested: !b.consNumber && !sm?.complete && suggested ? { pattern: suggested.pattern, route: suggested.route } : null,
        blockedReason: lock ?? b.blockedReason,
        alreadyInMaster: f2InMaster.get(b.key),
        typeMismatch: mismatches.get(b.key) ?? null,
        hvCount: tsvTrackings(b.hvRaw).trackings.size,
        cobrosCount: b.paymentsRaw ? b.paymentsRaw.split('\n').length - 1 : 0,
        uploaded: c?.uploadedAt ? { at: c.uploadedAt, byName: nameOf(c.uploadedById), minutes: c.uploadMinutes, via: c.uploadedVia } : byGuides,
        inSystem: sm && sm.found > 0 ? { found: sm.found, total: sm.total, complete: sm.complete, groups: sm.groups.slice(0, 4) } : null,
      };
    });

    const ready = msg.status === 'confirmado' || msg.status === 'detectado';
    const reason =
      msg.status === 'ignorado'
        ? 'Este correo está ignorado'
        : msg.status === 'error'
          ? 'Este correo no se pudo leer'
          : ready
            ? null
            : 'Primero confirma la sucursal';
    const inBatches = new Set(views.map((v) => v.consNumber).filter(Boolean));
    const announcedOnly = cons
      .filter((c) => !inBatches.has(c.consNumber))
      .map((c) => ({
        consNumber: c.consNumber,
        kind: c.kind,
        announcedCount: c.announcedCount,
        // COD y HV del texto viajan dentro del master cuando el libro trae su hoja.
        insideSheet: (c.kind === 'cod' && sheetRoles.has('cod')) || (c.kind === 'high_value' && sheetRoles.has('hv')) ? (c.kind === 'cod' ? 'COD' : 'HV') : null,
        uploaded: c.linkStatus === 'subido' && c.uploadedAt ? { at: c.uploadedAt, byName: nameOf(c.uploadedById), minutes: c.uploadMinutes, as: c.uploadedAs ?? null, asKind: c.uploadedAsKind ?? null } : null,
      }));
    const orphanCobros = unmatchedCobros({ cobros: cons.flatMap((c) => c.cobros ?? []), extraPaymentsRaw: extraPayments, attachments: planAtts });
    return { ready, reason, batches: views, announcedOnly, unmatchedCobros: orphanCobros };
  }

  /**
   * Validación dentro del correo, lado F2 → master: guías de cada bloque F2 que ya están como
   * paquete activo en el consolidado master de ESTE mismo correo (subido antes, o por otro camino
   * sin quitar la F2). Solo compara contra el master del correo, nunca contra el historial.
   */
  private async f2GuidesAlreadyInEmailMaster(batches: PasteBatch[]): Promise<Map<string, { count: number; consNumber: string }>> {
    const out = new Map<string, { count: number; consNumber: string }>();
    const masters = [...new Set(batches.filter((b) => b.kind !== 'f2' && b.consNumber).map((b) => b.consNumber.trim()))];
    if (!masters.length) return out;
    for (const b of batches.filter((x) => x.kind === 'f2')) {
      const tns = [...tsvTrackings(b.raw).trackings];
      if (!tns.length) continue;
      const rows: any[] = await this.ds.query(
        `SELECT TRIM(c.consNumber) AS cons, COUNT(DISTINCT s.trackingNumber) AS n
         FROM shipment s JOIN consolidated c ON c.id = s.consolidatedId
         WHERE s.active = 1 AND c.active = 1 AND TRIM(c.consNumber) IN (${masters.map(() => '?').join(',')})
           AND s.trackingNumber IN (${tns.map(() => '?').join(',')})
         GROUP BY TRIM(c.consNumber) ORDER BY n DESC LIMIT 1`,
        [...masters, ...tns],
      );
      if (rows[0] && Number(rows[0].n) > 0) out.set(b.key, { count: Number(rows[0].n), consNumber: rows[0].cons });
    }
    return out;
  }

  /**
   * ¿Las guías de cada bloque se subieron con el OTRO tipo? F2 del correo que quedó como paquete,
   * o master que quedó como carga (sin contar las guías que el correo trae en su F2). Misma ventana
   * que la revisión por guías (6 h antes a 5 días después del correo). Si el correo anuncia como F2
   * ese mismo número (p. ej. "CARGA SUR": toda la carga), que esté como carga es lo correcto.
   */
  private async typeMismatches(batches: PasteBatch[], receivedAt: Date, announcedF2 = new Set<string>()): Promise<Map<string, TypeMismatch>> {
    const out = new Map<string, TypeMismatch>();
    const from = new Date(receivedAt.getTime() - 6 * 3_600_000);
    const to = new Date(receivedAt.getTime() + 5 * 86_400_000);
    const f2Guides = new Set(batches.filter((b) => b.kind === 'f2').flatMap((b) => [...tsvTrackings(b.raw).trackings]));
    for (const b of batches) {
      const toType: 'carga' | 'paquete' = b.kind === 'f2' ? 'carga' : 'paquete';
      const wrongTable = toType === 'carga' ? 'shipment' : 'charge_shipment';
      const rightTable = toType === 'carga' ? 'charge_shipment' : 'shipment';
      const tns = [...tsvTrackings(b.raw).trackings].filter((t) => toType === 'carga' || !f2Guides.has(t));
      if (!tns.length) continue;
      const ph = tns.map(() => '?').join(',');
      const wrong: any[] = await this.ds.query(
        `SELECT x.consolidatedId AS cid, TRIM(c.consNumber) AS cons, c.subsidiaryId AS sid, s.name AS sname, COUNT(*) AS n
           FROM \`${wrongTable}\` x JOIN consolidated c ON c.id = x.consolidatedId JOIN subsidiary s ON s.id = c.subsidiaryId
          WHERE x.active = 1 AND c.active = 1 AND x.trackingNumber IN (${ph}) AND x.createdAt BETWEEN ? AND ?
          GROUP BY x.consolidatedId, c.consNumber, c.subsidiaryId, s.name ORDER BY n DESC LIMIT 1`,
        [...tns, from, to],
      );
      const w = wrong[0];
      if (!w || !Number(w.n)) continue;
      // A paquete solo si es el MISMO número de FedEx del correo: las rutas locales (Hermosillo 367–369)
      // suben como carga con número propio a propósito; y si el correo lo anuncia como F2, es carga.
      if (toType === 'paquete' && (w.cons !== b.consNumber?.trim() || announcedF2.has(w.cons) || batches.some((x) => x.kind === 'f2' && x.consNumber?.trim() === w.cons))) continue;
      const found: string[] = (
        await this.ds.query(`SELECT DISTINCT TRIM(trackingNumber) AS t FROM \`${wrongTable}\` WHERE consolidatedId = ? AND active = 1 AND trackingNumber IN (${ph})`, [w.cid, ...tns])
      ).map((r: any) => r.t);
      const [{ total }] = await this.ds.query(`SELECT COUNT(*) AS total FROM \`${wrongTable}\` WHERE consolidatedId = ? AND active = 1`, [w.cid]);
      const right: any[] = await this.ds.query(
        `SELECT x.consolidatedId AS cid, TRIM(c.consNumber) AS cons, COUNT(*) AS n
           FROM \`${rightTable}\` x JOIN consolidated c ON c.id = x.consolidatedId
          WHERE x.active = 1 AND c.active = 1 AND c.subsidiaryId = ? AND x.trackingNumber IN (${found.map(() => '?').join(',')})
          GROUP BY x.consolidatedId, c.consNumber ORDER BY n DESC LIMIT 1`,
        [w.sid, ...found],
      );
      const pend: any[] = await this.ds.query(
        "SELECT 1 FROM approval_request WHERE status = 'pendiente' AND targetKey = ? LIMIT 1",
        [familyKey(w.cons, w.sid)],
      );
      out.set(b.key, {
        toType,
        consolidatedId: w.cid,
        consNumber: w.cons,
        subsidiaryName: w.sname,
        count: found.length,
        trackingNumbers: found,
        whole: found.length >= Number(total),
        targetConsolidatedId: right[0]?.cid ?? null,
        targetConsNumber: right[0]?.cons ?? null,
        emailConsNumber: b.consNumber?.trim() || null,
        pending: pend.length > 0,
      });
    }
    return out;
  }

  private patternCache = new Map<string, { at: number; pattern: RoutePattern | null }>();

  /** Formato de número propio que usa la sucursal (de sus consolidados y cargas de los últimos 30 días). */
  private async routePatternOf(subsidiaryId: string | null): Promise<RoutePattern | null> {
    if (!subsidiaryId) return null;
    const hit = this.patternCache.get(subsidiaryId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.pattern;
    const rows: any[] = await this.ds.query(
      `SELECT TRIM(consNumber) AS cons, DATE_FORMAT(DATE_SUB(createdAt, INTERVAL 7 HOUR), '%Y-%m-%d') AS day FROM consolidated
        WHERE subsidiaryId = ? AND active = 1 AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       UNION ALL
       SELECT TRIM(consNumber), DATE_FORMAT(DATE_SUB(createdAt, INTERVAL 7 HOUR), '%Y-%m-%d') FROM charge
        WHERE subsidiaryId = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [subsidiaryId, subsidiaryId],
    );
    const pattern = detectRoutePattern(rows.map((r) => ({ consNumber: String(r.cons ?? ''), day: String(r.day) })));
    this.patternCache.set(subsidiaryId, { at: Date.now(), pattern });
    return pattern;
  }

  /** Consolidados activos con ese número en OTRA sucursal (master/aéreo en consolidated, F2 en charge). */
  private async activeInOtherSubsidiary(consNumbers: string[], subsidiaryId: string | null): Promise<Map<string, { subsidiaryName: string; byName: string | null; at: Date }>> {
    const out = new Map<string, { subsidiaryName: string; byName: string | null; at: Date }>();
    const list = [...new Set(consNumbers.map((c) => c.trim()).filter(Boolean))];
    if (!list.length || !subsidiaryId) return out;
    const ph = list.map(() => '?').join(',');
    const rows: any[] = await this.ds.query(
      `SELECT TRIM(x.consNumber) AS cons, s.name AS sub, x.createdAt AS at, TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lastName, ''))) AS byName
       FROM (SELECT consNumber, subsidiaryId, createdAt, createdById FROM consolidated WHERE active = 1 AND TRIM(consNumber) IN (${ph})
             UNION ALL SELECT consNumber, subsidiaryId, createdAt, createdById FROM charge WHERE TRIM(consNumber) IN (${ph})) x
       JOIN subsidiary s ON s.id = x.subsidiaryId LEFT JOIN \`user\` u ON u.id = x.createdById
       WHERE x.subsidiaryId <> ? ORDER BY x.createdAt ASC`,
      [...list, ...list, subsidiaryId],
    );
    for (const r of rows) if (!out.has(r.cons)) out.set(r.cons, { subsidiaryName: r.sub, byName: r.byName || null, at: new Date(r.at) });
    return out;
  }

  /** Adjuntos idénticos (mismo contenido) que ya se subieron desde OTRO correo → asunto de ese correo. */
  private async alreadySentFromOtherEmail(atts: InboxAttachment[], messageId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const hashes = [...new Set(atts.map((a) => a.sha256).filter(Boolean))];
    if (!hashes.length) return out;
    const rows: any[] = await this.ds.query(
      `SELECT a.sha256, m.subject FROM inbox_attachment a JOIN inbox_message m ON m.id = a.inboxMessageId
       WHERE a.sha256 IN (${hashes.map(() => '?').join(',')}) AND a.inboxMessageId <> ? AND a.pastedAt IS NOT NULL`,
      [...hashes, messageId],
    );
    for (const a of atts) {
      const hit = rows.find((r) => r.sha256 === a.sha256);
      if (hit) out.set(a.id, hit.subject || '(sin asunto)');
    }
    return out;
  }

  /** Registra que un lote se mandó y subió desde el pegado. */
  async markPasted(messageId: string, body: MarkPastedBody, userId: string | null): Promise<void> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('No se encontró ese correo');
    const att = await this.attRepo.findOne({ where: { id: body?.attachmentId, inboxMessageId: messageId } });
    if (!att) throw new BadRequestException('Ese archivo no es de este correo');
    att.pastedAt = new Date();
    if (body.key) att.pastedKeys = [...new Set([...(att.pastedKeys ?? []), String(body.key)])];
    att.pastedById = userId;
    await this.attRepo.save(att);

    const consNumber = String(body.consNumber ?? '').trim();
    if (!consNumber) return;
    const kind: ConsolidationKind = body.kind === 'aereo' ? 'aereo' : body.kind === 'f2' ? 'f2' : 'master';
    const now = new Date();
    let c = await this.consRepo.findOne({ where: { consNumber, kind } });
    if (!c) {
      c = this.consRepo.create({ inboxMessageId: messageId, consNumber, kind, subsidiaryId: msg.subsidiaryId, receivedAt: msg.receivedAt, announcedCount: null, cobros: null });
    }
    c.uploadedAt = c.uploadedAt ?? now;
    c.uploadedById = c.uploadedById ?? userId;
    c.uploadedVia = 'correo';
    c.uploadMinutes = c.uploadMinutes ?? uploadMinutes(c.receivedAt, now);
    c.linkStatus = 'subido';
    await this.consRepo.save(c);

    // Aviso a los grupos de monitoreo; nunca detiene la respuesta.
    void this.notifyUpload(msg, att, body, consNumber, userId, now).catch((e) => this.logger.warn(`[inbox] aviso de subida: ${e?.message ?? e}`));
  }

  /** WhatsApp a los grupos configurados (o por nombre: PMY Monitoreo / Sistemas PMY). */
  private async notifyUpload(msg: InboxMessage, att: InboxAttachment, body: MarkPastedBody, consNumber: string, userId: string | null, now: Date): Promise<void> {
    const cfg: any[] = await this.ds.query('SELECT uploadNotifyEnabled, uploadNotifyGroups FROM ops_alert_settings LIMIT 1');
    if (cfg[0] && !Number(cfg[0].uploadNotifyEnabled)) return;
    const raw = cfg[0]?.uploadNotifyGroups;
    let groups: { id: string; name: string }[] = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? [];
    if (!groups.length) {
      for (const name of DEFAULT_UPLOAD_GROUPS) {
        const id = await this.whatsapp.findGroupJid(name);
        if (id && !groups.some((g) => g.id === id)) groups.push({ id, name });
      }
    }
    if (!groups.length) {
      this.logger.warn('[inbox] aviso de subida: no hay grupos de WhatsApp configurados ni encontrados por nombre');
      return;
    }
    const [user]: any[] = userId ? await this.ds.query('SELECT name, lastName, email FROM `user` WHERE id = ?', [userId]) : [];
    const [sub]: any[] = msg.subsidiaryId ? await this.ds.query('SELECT name FROM subsidiary WHERE id = ?', [msg.subsidiaryId]) : [];
    const text = buildUploadMessage({
      userName: user ? [user.name, user.lastName].filter(Boolean).join(' ') || user.email : 'Alguien',
      filename: att.filename,
      sheet: body.sheet ?? null,
      subsidiaryName: sub?.name ?? 'Sin sucursal',
      kind: body.kind === 'aereo' ? 'aereo' : body.kind === 'f2' ? 'f2' : 'master',
      consNumber,
      consDate: body.consDate ?? null,
      fileRows: body.fileRows ?? null,
      summary: body.summary ?? {},
      cobrosInEmail: body.cobrosCount,
      email: { subject: msg.subject, from: msg.fromName || msg.fromAddress, receivedAt: msg.receivedAt },
      uploadedAt: now,
    });
    const userName = user ? [user.name, user.lastName].filter(Boolean).join(' ') || user.email : null;
    const ctx = { origin: 'subida' as const, sentById: userId, sentByName: userName, subsidiaryId: msg.subsidiaryId, consNumber, inboxMessageId: msg.id };
    const title = `Subida desde la bandeja · ${att.filename}`.slice(0, 255);
    for (const g of groups) await this.sendLog.whatsappTo(g, text, ctx, title);
  }
}

export interface MarkPastedBody {
  attachmentId: string;
  kind: PasteBatchKind;
  consNumber: string;
  key?: string;
  sheet?: string | null;
  consDate?: string | null;
  fileRows?: number | null;
  cobrosCount?: number;
  summary?: UploadSummary;
}
