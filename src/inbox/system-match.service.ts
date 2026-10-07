import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { workbookSheets } from './attachment-classify.util';
import { expandWorkbook, tsvTrackings } from './paste-plan.util';
import { coverageOf, MatchSummary, summarizeMatch, SystemHit } from './system-match.util';
import { uploadMinutes } from './zip-coverage.util';
import { InboxIngestService } from './inbox-ingest.service';

const GUIDE_KINDS = ['master', 'master_aereo', 'f2', 'high_value'];
/** Ventana: la guía cuenta como "subida desde este correo" si se registró desde 6 h antes hasta 5 días después. */
const BEFORE_MS = 6 * 3_600_000;
const AFTER_MS = 5 * 86_400_000;

/**
 * Revisa POR GUÍAS si lo que trae cada correo ya está en el sistema (paquete o carga F2),
 * en cualquier sucursal. Guarda el resultado por hoja, la cobertura del correo, liga los
 * consolidados encontrados (para Seguimiento/alertas) y vuelve a detectar la sucursal.
 */
@Injectable()
export class SystemMatchService {
  private readonly logger = new Logger(SystemMatchService.name);
  private running = false;

  constructor(
    @InjectRepository(InboxMessage) private readonly msgRepo: Repository<InboxMessage>,
    @InjectRepository(InboxAttachment) private readonly attRepo: Repository<InboxAttachment>,
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    private readonly ingest: InboxIngestService,
    private readonly ds: DataSource,
  ) {}

  private async hits(trackings: string[], from: Date, to: Date): Promise<SystemHit[]> {
    if (!trackings.length) return [];
    const ph = trackings.map(() => '?').join(',');
    const rows: any[] = await this.ds.query(
      `SELECT x.trackingNumber AS t, TRIM(COALESCE(x.cons, '')) AS cons, x.subsidiaryId AS sid, s.name AS sname, x.createdAt AS at,
              TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lastName, ''))) AS byName, x.type
       FROM (
         SELECT sh.trackingNumber, c.consNumber AS cons, sh.subsidiaryId, sh.createdAt, COALESCE(c.createdById, NULL) AS createdById, 'paquete' AS type
         FROM shipment sh LEFT JOIN consolidated c ON c.id = sh.consolidatedId
         WHERE sh.active = 1 AND sh.trackingNumber IN (${ph}) AND sh.createdAt BETWEEN ? AND ?
         UNION ALL
         SELECT cs.trackingNumber, ch.consNumber AS cons, cs.subsidiaryId, cs.createdAt, cs.createdById, 'carga' AS type
         FROM charge_shipment cs LEFT JOIN charge ch ON ch.id = cs.chargeId
         WHERE cs.active = 1 AND cs.trackingNumber IN (${ph}) AND cs.createdAt BETWEEN ? AND ?
       ) x
       JOIN subsidiary s ON s.id = x.subsidiaryId
       LEFT JOIN \`user\` u ON u.id = x.createdById`,
      [...trackings, from, to, ...trackings, from, to],
    );
    return rows.map((r) => ({
      tracking: String(r.t).trim(),
      consNumber: r.cons || '(sin número)',
      subsidiaryId: r.sid,
      subsidiaryName: r.sname,
      at: new Date(r.at),
      byName: r.byName || null,
      type: r.type === 'carga' ? 'carga' : 'paquete',
    }));
  }

  /** Revisa un correo; devuelve la cobertura nueva. */
  async matchMessage(msg: InboxMessage): Promise<'ninguno' | 'parcial' | 'completo' | null> {
    const atts = await this.attRepo.find({ where: { inboxMessageId: msg.id } });
    const from = new Date(msg.receivedAt.getTime() - BEFORE_MS);
    const to = new Date(msg.receivedAt.getTime() + AFTER_MS);
    const units: MatchSummary[] = [];
    const seen = new Set<string>(); // archivos repetidos (mismas guías) cuentan una vez

    for (const a of atts) {
      if (!GUIDE_KINDS.includes(a.kind)) continue;
      let sheets: Awaited<ReturnType<typeof workbookSheets>> = [];
      try {
        sheets = workbookSheets(await fs.readFile(join(process.cwd(), a.storagePath)));
      } catch {
        continue;
      }
      const ex = expandWorkbook({ id: a.id, filename: a.filename, kind: a.kind, consNumber: a.consNumber }, sheets);
      const result: Record<string, MatchSummary> = {};
      for (const u of ex.units) {
        const tns = [...tsvTrackings(u.tsv).trackings];
        if (!tns.length) continue;
        const summary = summarizeMatch(tns, await this.hits(tns, from, to));
        result[u.sheet ?? '_'] = summary;
        const sig = [...tns].sort().join(',');
        if (!seen.has(sig)) {
          seen.add(sig);
          units.push(summary);
        }
        await this.linkGroups(msg, u.kind, summary);
      }
      a.systemMatch = result;
      await this.attRepo.save(a);
    }

    const coverage = coverageOf(units);
    msg.uploadCoverage = coverage;
    msg.matchedAt = new Date();
    await this.msgRepo.save(msg);
    return coverage;
  }

  /** Registra los consolidados encontrados (con número propio de la sucursal) para Seguimiento/alertas. */
  private async linkGroups(msg: InboxMessage, unitKind: string, s: MatchSummary) {
    for (const g of s.groups) {
      if (g.consNumber === '(sin número)' || g.count < Math.max(3, Math.ceil(s.total * 0.3))) continue;
      const kind = g.type === 'carga' ? 'f2' : unitKind === 'master_aereo' ? 'aereo' : 'master';
      const exists = await this.consRepo.findOne({ where: { consNumber: g.consNumber, kind } });
      if (exists) {
        if (exists.linkStatus === 'pendiente') {
          exists.linkStatus = 'subido';
          exists.uploadedAt = g.at;
          exists.uploadMinutes = uploadMinutes(exists.receivedAt, g.at);
          exists.uploadedVia = exists.uploadedVia ?? 'manual';
          await this.consRepo.save(exists);
        }
        continue;
      }
      const userRow: any[] = await this.ds.query(
        `SELECT createdById FROM ${kind === 'f2' ? 'charge' : 'consolidated'} WHERE TRIM(consNumber) = ? AND subsidiaryId = ? ORDER BY createdAt LIMIT 1`,
        [g.consNumber, g.subsidiaryId],
      );
      await this.consRepo.save(
        this.consRepo.create({
          inboxMessageId: msg.id,
          consNumber: g.consNumber,
          kind,
          subsidiaryId: g.subsidiaryId,
          announcedCount: s.total,
          cobros: null,
          receivedAt: msg.receivedAt,
          uploadedAt: g.at,
          uploadedById: userRow[0]?.createdById ?? null,
          uploadedVia: 'manual',
          uploadMinutes: uploadMinutes(msg.receivedAt, g.at),
          linkStatus: 'subido',
        }),
      );
    }
  }

  /**
   * Correos recientes que todavía no están completos en el sistema. Después de revisar,
   * vuelve a detectar la sucursal de los no confirmados (las guías ya registradas son la
   * pista más fuerte).
   */
  async matchRecent(days = 7, limit = 60): Promise<{ checked: number; complete: number }> {
    if (this.running) return { checked: 0, complete: 0 };
    this.running = true;
    let checked = 0;
    let complete = 0;
    try {
      const since = new Date(Date.now() - days * 86_400_000);
      const msgs = await this.msgRepo
        .createQueryBuilder('m')
        .where('m.receivedAt >= :since', { since })
        .andWhere("m.status NOT IN ('ignorado','error')")
        .andWhere("(m.uploadCoverage IS NULL OR m.uploadCoverage <> 'completo')")
        .andWhere(`EXISTS (SELECT 1 FROM inbox_attachment a WHERE a.inboxMessageId = m.id AND a.kind IN ('master','master_aereo','f2','high_value'))`)
        .orderBy('m.matchedAt', 'ASC') // los nunca revisados (NULL) primero
        .take(limit)
        .getMany();
      const toRedetect: string[] = [];
      for (const m of msgs) {
        const cov = await this.matchMessage(m);
        checked++;
        if (cov === 'completo') complete++;
        if (cov && cov !== 'ninguno' && m.status !== 'confirmado') toRedetect.push(m.id);
      }
      if (toRedetect.length) await this.ingest.redetect(toRedetect);
    } catch (e: any) {
      this.logger.error(`[inbox] revisión por guías: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
    return { checked, complete };
  }
}
