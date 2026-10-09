import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { classifySheetName, workbookSheets } from './attachment-classify.util';
import { expandWorkbook, tsvTrackings } from './paste-plan.util';
import { announcedTargetFor, coverageOf, MatchSummary, summarizeMatch, SystemHit } from './system-match.util';
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
    const from = new Date((await this.firstSeenAt(msg, atts)).getTime() - BEFORE_MS);
    const to = new Date(msg.receivedAt.getTime() + AFTER_MS);
    const units: MatchSummary[] = [];
    const seen = new Set<string>(); // archivos repetidos (mismas guías) cuentan una vez

    for (const a of atts) {
      if (!GUIDE_KINDS.includes(a.kind)) continue;
      let sheets: Awaited<ReturnType<typeof workbookSheets>> = [];
      try {
        sheets = workbookSheets(await fs.readFile(join(process.cwd(), a.storagePath)));
      } catch {
        // Sin el archivo (p. ej. borrado del disco) se usa lo que encontró la última revisión.
        for (const [sheet, summary] of Object.entries(a.systemMatch ?? {})) {
          const sig = `${a.id}:${sheet}`;
          if (!seen.has(sig)) {
            seen.add(sig);
            units.push(summary);
          }
          // La hoja "F2" de un libro master es una F2 (igual que al leer el archivo).
          const unitKind = sheet !== '_' && classifySheetName(sheet) === 'f2' ? 'f2' : a.kind;
          await this.linkGroups(msg, unitKind, summary, sheet === '_' ? a.consNumber ?? null : null);
        }
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
        await this.linkGroups(msg, u.kind, summary, u.consNumber ?? null);
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

  /**
   * Correo reenviado: las guías pudieron subirse con el correo ORIGINAL (días antes). La ventana
   * arranca en el primer correo que trajo los mismos consolidados o el mismo archivo.
   */
  private async firstSeenAt(msg: InboxMessage, atts: InboxAttachment[]): Promise<Date> {
    let first = msg.receivedAt;
    const shas = atts.filter((a) => GUIDE_KINDS.includes(a.kind)).map((a) => a.sha256);
    if (shas.length) {
      const [r]: any[] = await this.ds.query(
        `SELECT MIN(m.receivedAt) AS at FROM inbox_attachment a JOIN inbox_message m ON m.id = a.inboxMessageId WHERE a.sha256 IN (${shas.map(() => '?').join(',')})`,
        shas,
      );
      if (r?.at && new Date(r.at) < first) first = new Date(r.at);
    }
    const nums = [...new Set(atts.map((a) => a.consNumber).filter((x): x is string => !!x))];
    if (nums.length) {
      const [r]: any[] = await this.ds.query(`SELECT MIN(receivedAt) AS at FROM inbox_consolidation WHERE consNumber IN (${nums.map(() => '?').join(',')})`, nums);
      if (r?.at && new Date(r.at) < first) first = new Date(r.at);
    }
    // No más de 7 días atrás: una guía puede volver a usarse mucho después.
    const floor = new Date(msg.receivedAt.getTime() - 7 * 86_400_000);
    return first < floor ? floor : first;
  }

  /** Registra los consolidados encontrados (con número propio de la sucursal) para Seguimiento/alertas. */
  private async linkGroups(msg: InboxMessage, unitKind: string, s: MatchSummary, unitConsNumber: string | null) {
    for (const g of s.groups) {
      if (g.consNumber === '(sin número)' || g.count < Math.max(3, Math.ceil(s.total * 0.3))) continue;
      const kind = g.type === 'carga' ? 'f2' : unitKind === 'master_aereo' ? 'aereo' : 'master';
      const at = new Date(g.at); // del resultado guardado llega como texto
      const userRow: any[] = await this.ds.query(
        `SELECT createdById FROM ${kind === 'f2' ? 'charge' : 'consolidated'} WHERE TRIM(consNumber) = ? AND subsidiaryId = ? ORDER BY createdAt LIMIT 1`,
        [g.consNumber, g.subsidiaryId],
      );

      // ¿Es el consolidado que ANUNCIÓ el correo, subido con otro número? Se marca ese mismo como
      // "Subido como …" (una sola fila por las mismas guías) y se quita el duplicado si ya existía.
      const announced = await this.consRepo.find({ where: { inboxMessageId: msg.id } });
      let target = announcedTargetFor(announced, { consNumber: g.consNumber, kind }, unitConsNumber);
      // F2 del correo cuyas guías quedaron como PAQUETE (tipo equivocado): está subida, no pendiente.
      // Se liga a la F2 anunciada; el aviso de "tipo equivocado" de la bandeja sigue para corregirlo.
      const wrongType = !target && unitKind === 'f2' && kind !== 'f2';
      if (wrongType) target = announcedTargetFor(announced, { consNumber: g.consNumber, kind: 'f2' }, unitConsNumber);
      if (target) {
        const row = announced.find((a) => a.consNumber === target)!;
        row.linkStatus = 'subido';
        row.uploadedAs = g.consNumber;
        row.uploadedAsKind = kind === 'f2' ? 'f2' : 'master';
        row.uploadedAt = at;
        row.uploadedById = row.uploadedById ?? userRow[0]?.createdById ?? null;
        row.uploadMinutes = uploadMinutes(row.receivedAt, at);
        row.uploadedVia = row.uploadedVia ?? 'manual';
        await this.consRepo.save(row);
        if (wrongType) continue; // el master es otro consolidado de verdad: no se oculta
        const dup = announced.find((a) => a.consNumber === g.consNumber && a.kind === kind && a.linkStatus === 'subido' && !a.cobros);
        if (dup) {
          dup.linkStatus = 'no_aplica';
          await this.consRepo.save(dup);
        }
        continue;
      }

      const exists = await this.consRepo.findOne({ where: { consNumber: g.consNumber, kind } });
      if (exists) {
        if (exists.linkStatus === 'pendiente') {
          exists.linkStatus = 'subido';
          exists.uploadedAt = at;
          exists.uploadMinutes = uploadMinutes(exists.receivedAt, at);
          exists.uploadedVia = exists.uploadedVia ?? 'manual';
          await this.consRepo.save(exists);
        }
        continue;
      }
      await this.consRepo.save(
        this.consRepo.create({
          inboxMessageId: msg.id,
          consNumber: g.consNumber,
          kind,
          subsidiaryId: g.subsidiaryId,
          announcedCount: s.total,
          cobros: null,
          receivedAt: msg.receivedAt,
          uploadedAt: at,
          uploadedById: userRow[0]?.createdById ?? null,
          uploadedVia: 'manual',
          uploadMinutes: uploadMinutes(msg.receivedAt, at),
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
        .andWhere(
          `(m.uploadCoverage IS NULL OR m.uploadCoverage <> 'completo'
            OR EXISTS (SELECT 1 FROM inbox_consolidation c WHERE c.inboxMessageId = m.id AND c.linkStatus = 'pendiente' AND c.kind IN ('master','aereo','f2')))`,
        )
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
