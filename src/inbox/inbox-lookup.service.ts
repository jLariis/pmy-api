import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Scope } from './inbox-query.service';
import { cleanTracking } from './guide-index.util';
import { bucketOf, countBuckets, dexCode, guideInsights, Insight } from './lookup-insights.util';
import { analyzeConsolidated, GuideFact } from '../ops-alerts/consolidated-analysis.util';

type HeadType = 'paquete' | 'carga';

/** Dónde aparece algo en un correo. */
export interface EmailRef {
  id: string;
  subject: string;
  receivedAt: Date;
  carrier: string;
  subsidiaryName: string | null;
  /** "Archivo 7-364.xlsx · hoja F2", "Anunciado en el correo", … */
  where: string;
  attachmentId: string | null;
  filename: string | null;
  sheet: string | null;
  /** Para consolidados ligados por guías: cuántas de sus guías trae el correo. */
  guides?: number;
}

const UNIT_LABEL: Record<string, string> = {
  master: 'Master',
  master_aereo: 'Aéreo',
  f2: 'F2',
  high_value: 'Alto valor',
  cod: 'Cobros (COD)',
  dhl: 'DHL',
  cobro: 'Cobro anunciado',
};

const GUIDE_FILE_KINDS = "('master','master_aereo','f2','high_value','dhl')";
const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');
const num = (v: unknown) => (v == null ? 0 : Number(v));
const parseJsonList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try {
      const x = JSON.parse(v);
      return Array.isArray(x) ? x.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * Buscador de Correos: encuentra en qué correo llegó un consolidado o una guía y arma su
 * historia completa (desembarque, faltantes/sobrantes, rutas, entregas, DEX, devoluciones,
 * ingresos) para decidir qué hacer. Solo lectura.
 */
@Injectable()
export class InboxLookupService {
  constructor(private readonly ds: DataSource) {}

  private inScope(subsidiaryId: string | null, scope: Scope): boolean {
    return scope === null || (!!subsidiaryId && scope.includes(subsidiaryId));
  }

  private scopeSql(col: string, scope: Scope): { sql: string; params: string[] } {
    if (scope === null) return { sql: '', params: [] };
    if (!scope.length) return { sql: ' AND 1 = 0', params: [] };
    return { sql: ` AND ${col} IN (${ph(scope.length)})`, params: scope };
  }

  // ───────────────────────── correos ─────────────────────────

  /** Correos que traen alguna de estas guías (índice inbox_guide). */
  private async emailsWithGuides(trackings: string[], scope: Scope, opts: { minGuides?: number; around?: Date } = {}): Promise<EmailRef[]> {
    if (!trackings.length) return [];
    const sc = this.scopeSql('m.subsidiaryId', scope);
    const params: any[] = [...trackings];
    let dateSql = '';
    if (opts.around) {
      // Una guía puede volver a usarse mucho después: solo correos cercanos al consolidado.
      dateSql = ' AND m.receivedAt BETWEEN ? AND ?';
      params.push(new Date(opts.around.getTime() - 7 * 86_400_000), new Date(opts.around.getTime() + 3 * 86_400_000));
    }
    const rows: any[] = await this.ds.query(
      `SELECT m.id, m.subject, m.receivedAt, m.carrier, s.name AS sname, g.inboxAttachmentId AS attId, a.filename, g.sheet, g.unitKind,
              COUNT(DISTINCT g.trackingNumber) AS n
       FROM inbox_guide g
       JOIN inbox_message m ON m.id = g.inboxMessageId
       LEFT JOIN inbox_attachment a ON a.id = g.inboxAttachmentId
       LEFT JOIN subsidiary s ON s.id = m.subsidiaryId
       WHERE g.trackingNumber IN (${ph(trackings.length)}) AND m.status <> 'ignorado'${dateSql}${sc.sql}
       GROUP BY m.id, m.subject, m.receivedAt, m.carrier, s.name, g.inboxAttachmentId, a.filename, g.sheet, g.unitKind
       ORDER BY m.receivedAt DESC
       LIMIT 50`,
      [...params, ...sc.params],
    );
    const min = opts.minGuides ?? 1;
    return rows
      .filter((r) => num(r.n) >= min)
      .map((r) => ({
        id: r.id,
        subject: r.subject,
        receivedAt: new Date(r.receivedAt),
        carrier: r.carrier,
        subsidiaryName: r.sname ?? null,
        where: r.filename
          ? `Archivo ${r.filename}${r.sheet ? ` · hoja ${r.sheet}` : ''} (${UNIT_LABEL[r.unitKind] ?? r.unitKind})`
          : r.unitKind === 'cobro'
            ? 'En los cobros del correo'
            : 'En el texto del correo',
        attachmentId: r.attId ?? null,
        filename: r.filename ?? null,
        sheet: r.sheet ?? null,
        guides: num(r.n),
      }));
  }

  /** Correos que ANUNCIAN el consolidado (número en asunto/cuerpo/archivo) o lo ligaron por "subido como". */
  private async emailsAnnouncing(consNumber: string, scope: Scope): Promise<EmailRef[]> {
    const sc = this.scopeSql('m.subsidiaryId', scope);
    const rows: any[] = await this.ds.query(
      `SELECT m.id, m.subject, m.receivedAt, m.carrier, s.name AS sname,
              (SELECT c.consNumber FROM inbox_consolidation c WHERE c.inboxMessageId = m.id AND (c.consNumber = ? OR c.uploadedAs = ?) LIMIT 1) AS announcedAs
       FROM inbox_message m LEFT JOIN subsidiary s ON s.id = m.subsidiaryId
       WHERE m.status <> 'ignorado'
         AND (EXISTS (SELECT 1 FROM inbox_consolidation c WHERE c.inboxMessageId = m.id AND (c.consNumber = ? OR c.uploadedAs = ?))
              OR EXISTS (SELECT 1 FROM inbox_attachment a WHERE a.inboxMessageId = m.id AND a.consNumber = ?))${sc.sql}
       ORDER BY m.receivedAt DESC
       LIMIT 20`,
      [consNumber, consNumber, consNumber, consNumber, consNumber, ...sc.params],
    );
    if (!rows.length) return [];
    // Solo archivos con guías (la carta porte también trae el número, pero no sirve para buscar).
    const files: any[] = await this.ds.query(
      `SELECT id, inboxMessageId, filename, consNumber FROM inbox_attachment WHERE inboxMessageId IN (${ph(rows.length)}) AND kind IN ${GUIDE_FILE_KINDS}`,
      rows.map((r) => r.id),
    );
    const out: EmailRef[] = [];
    for (const r of rows) {
      const base = { id: r.id, subject: r.subject, receivedAt: new Date(r.receivedAt), carrier: r.carrier, subsidiaryName: r.sname ?? null, sheet: null };
      const mine = files.filter((f) => f.inboxMessageId === r.id);
      const own = mine.filter((f) => f.consNumber === consNumber);
      const shown = own.length ? own : mine.length === 1 ? mine : [];
      const note = r.announcedAs && r.announcedAs !== consNumber ? ` · anunciado como ${r.announcedAs}` : '';
      if (!shown.length) out.push({ ...base, where: `Anunciado en el correo${note}`, attachmentId: null, filename: null });
      for (const f of shown) out.push({ ...base, where: `Archivo ${f.filename}${note}`, attachmentId: f.id, filename: f.filename });
    }
    return out;
  }

  private mergeEmails(...lists: EmailRef[][]): EmailRef[] {
    const out = new Map<string, EmailRef>();
    for (const list of lists)
      for (const e of list) {
        const key = `${e.id}|${e.attachmentId ?? ''}|${e.sheet ?? ''}`;
        if (!out.has(key)) out.set(key, e);
      }
    return [...out.values()].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  }

  // ───────────────────────── búsqueda ─────────────────────────

  async search(rawQ: string, scope: Scope) {
    const q = String(rawQ ?? '').trim();
    if (q.length < 3) throw new BadRequestException('Escribe al menos 3 caracteres');
    const compact = q.replace(/\s+/g, '');
    const tracking = cleanTracking(compact);

    const [consolidations, guides, messages] = await Promise.all([
      /^\d{4,}$/.test(compact) ? this.searchConsolidations(compact, scope) : Promise.resolve([]),
      tracking ? this.searchGuides(tracking, scope) : Promise.resolve([]),
      this.searchText(q, scope),
    ]);
    return { query: q, consolidations, guides, messages };
  }

  private async searchConsolidations(cons: string, scope: Scope) {
    const sc = this.scopeSql('h.subsidiaryId', scope);
    const exact = (op: string) =>
      this.ds.query(
        `SELECT * FROM (
           SELECT h.id, TRIM(h.consNumber) AS consNumber, 'paquete' AS type, h.subsidiaryId, s.name AS sname, DATE_FORMAT(h.date, '%Y-%m-%d') AS day, h.createdAt,
                  h.numberOfPackages AS declared, (SELECT COUNT(*) FROM shipment g WHERE g.consolidatedId = h.id AND g.active = 1) AS total
           FROM consolidated h JOIN subsidiary s ON s.id = h.subsidiaryId
           WHERE h.active = 1 AND TRIM(h.consNumber) ${op} ?${sc.sql}
           UNION ALL
           SELECT h.id, TRIM(h.consNumber), 'carga', h.subsidiaryId, s.name, DATE_FORMAT(h.chargeDate, '%Y-%m-%d'), h.createdAt,
                  h.numberOfPackages, (SELECT COUNT(*) FROM charge_shipment g WHERE g.chargeId = h.id AND g.active = 1)
           FROM charge h JOIN subsidiary s ON s.id = h.subsidiaryId
           WHERE h.active = 1 AND TRIM(h.consNumber) ${op} ?${sc.sql}
         ) x ORDER BY x.createdAt DESC LIMIT 10`,
        [op === '=' ? cons : `%${cons}%`, ...sc.params, op === '=' ? cons : `%${cons}%`, ...sc.params],
      );
    let rows: any[] = await exact('=');
    if (!rows.length && cons.length >= 6) rows = await exact('LIKE');

    const out = [];
    for (const r of rows) {
      const emails = await this.emailsAnnouncing(r.consNumber, scope);
      out.push({
        id: r.id,
        consNumber: r.consNumber,
        type: r.type as HeadType,
        subsidiaryName: r.sname,
        day: r.day,
        createdAt: new Date(r.createdAt),
        declared: r.declared == null ? null : num(r.declared),
        total: num(r.total),
        inSystem: true,
        emails,
      });
    }
    // Anunciado por correo pero todavía sin subir al sistema.
    if (!out.length) {
      const pending = await this.emailsAnnouncing(cons, scope);
      if (pending.length) {
        const [c]: any[] = await this.ds.query('SELECT kind, announcedCount FROM inbox_consolidation WHERE consNumber = ? ORDER BY receivedAt DESC LIMIT 1', [cons]);
        out.push({
          id: null,
          consNumber: cons,
          type: (c?.kind === 'f2' ? 'carga' : 'paquete') as HeadType,
          subsidiaryName: pending[0].subsidiaryName,
          day: null,
          createdAt: null,
          declared: c?.announcedCount == null ? null : num(c.announcedCount),
          total: 0,
          inSystem: false,
          emails: pending,
        });
      }
    }
    return out;
  }

  /** Registros activos de la guía (paquete o carga; DHL también por el JD de la pieza). */
  private async guideRecords(tracking: string, scope: Scope): Promise<any[]> {
    const sc = this.scopeSql('g.subsidiaryId', scope);
    return this.ds.query(
      `SELECT * FROM (
         SELECT g.id, 'paquete' AS type, TRIM(g.trackingNumber) AS trackingNumber, g.dhlUniqueId, g.status, g.subsidiaryId, s.name AS sname, g.createdAt,
                h.id AS headId, TRIM(h.consNumber) AS consNumber, g.carrierCode
         FROM shipment g JOIN subsidiary s ON s.id = g.subsidiaryId LEFT JOIN consolidated h ON h.id = g.consolidatedId
         WHERE g.active = 1 AND (g.trackingNumber = ? OR g.dhlUniqueId = ?)${sc.sql}
         UNION ALL
         SELECT g.id, 'carga', TRIM(g.trackingNumber), NULL, g.status, g.subsidiaryId, s.name, g.createdAt, h.id, TRIM(h.consNumber), g.carrierCode
         FROM charge_shipment g JOIN subsidiary s ON s.id = g.subsidiaryId LEFT JOIN charge h ON h.id = g.chargeId
         WHERE g.active = 1 AND g.trackingNumber = ?${sc.sql}
       ) x ORDER BY x.createdAt DESC LIMIT 20`,
      [tracking, tracking, ...sc.params, tracking, ...sc.params],
    );
  }

  private async searchGuides(tracking: string, scope: Scope) {
    const [records, emails] = await Promise.all([this.guideRecords(tracking, scope), this.emailsWithGuides([tracking], scope)]);
    // Correos del consolidado aunque el archivo no esté indexado (p. ej. ya no está en disco).
    const fromCons = (await Promise.all([...new Set(records.map((r) => r.consNumber).filter(Boolean))].map((c: string) => this.emailsAnnouncing(c, scope)))).flat();
    if (!records.length && !emails.length) return [];
    return [
      {
        trackingNumber: tracking,
        records: records.map((r) => ({
          id: r.id,
          type: r.type as HeadType,
          status: r.status,
          bucket: bucketOf(r.status),
          subsidiaryName: r.sname,
          consNumber: r.consNumber ?? null,
          createdAt: new Date(r.createdAt),
        })),
        emails: this.mergeEmails(emails, fromCons.map((e) => ({ ...e, where: `${e.where} (consolidado de la guía)` }))),
      },
    ];
  }

  private async searchText(q: string, scope: Scope): Promise<EmailRef[]> {
    const sc = this.scopeSql('m.subsidiaryId', scope);
    const like = `%${q}%`;
    const rows: any[] = await this.ds.query(
      `SELECT m.id, m.subject, m.receivedAt, m.carrier, s.name AS sname
       FROM inbox_message m LEFT JOIN subsidiary s ON s.id = m.subsidiaryId
       WHERE (m.subject LIKE ? OR m.fromAddress LIKE ? OR m.fromName LIKE ?)${sc.sql}
       ORDER BY m.receivedAt DESC LIMIT 15`,
      [like, like, like, ...sc.params],
    );
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      receivedAt: new Date(r.receivedAt),
      carrier: r.carrier,
      subsidiaryName: r.sname ?? null,
      where: 'En el asunto o remitente',
      attachmentId: null,
      filename: null,
      sheet: null,
    }));
  }

  // ───────────────────────── piezas comunes ─────────────────────────

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows: any[] = await this.ds.query(`SELECT id, name, lastName FROM \`user\` WHERE id IN (${ph(list.length)})`, list);
    return new Map(rows.map((r) => [r.id, [r.name, r.lastName].filter(Boolean).join(' ')]));
  }

  /** Salidas a ruta (con rutas, choferes, vehículo y cierre) de estas guías. */
  private async dispatchesOf(type: HeadType, guideIds: string[]) {
    if (!guideIds.length) return { byGuide: new Map<string, any[]>(), dispatches: [] as any[] };
    const col = type === 'carga' ? 'chargeShipmentId' : 'shipmentId';
    const rows: any[] = await this.ds.query(
      `SELECT ph.${col} AS gid, ph.closureStatus, pd.id, pd.trackingNumber AS folio, DATE_FORMAT(pd.routeDate, '%Y-%m-%d') AS routeDay, pd.createdAt, pd.status,
              pd.is315, s.name AS sname, v.name AS vehicleName, v.plateNumber, rc.closeDate, rc.createdAt AS closedAt, pd.createdById
       FROM package_dispatch_history ph
       JOIN package_dispatch pd ON pd.id = ph.dispatchId
       LEFT JOIN subsidiary s ON s.id = pd.subsidiaryId
       LEFT JOIN vehicle v ON v.id = pd.vehicleId
       LEFT JOIN route_closure rc ON rc.package_dispatch_id = pd.id
       WHERE ph.${col} IN (${ph(guideIds.length)})`,
      guideIds,
    );
    const ids = [...new Set(rows.map((r) => r.id))];
    const [routes, drivers, users] = await Promise.all([
      ids.length
        ? this.ds.query(`SELECT pr.dispatchId, GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS names FROM package_dispatch_routes pr JOIN route r ON r.id = pr.routeId WHERE pr.dispatchId IN (${ph(ids.length)}) GROUP BY pr.dispatchId`, ids)
        : [],
      ids.length
        ? this.ds.query(`SELECT pd.dispatchId, GROUP_CONCAT(DISTINCT d.name ORDER BY d.name SEPARATOR ', ') AS names FROM package_dispatch_drivers pd JOIN driver d ON d.id = pd.driverId WHERE pd.dispatchId IN (${ph(ids.length)}) GROUP BY pd.dispatchId`, ids)
        : [],
      this.userNames(rows.map((r) => r.createdById)),
    ]);
    const routeMap = new Map<string, string>((routes as any[]).map((r) => [r.dispatchId, r.names]));
    const driverMap = new Map<string, string>((drivers as any[]).map((r) => [r.dispatchId, r.names]));
    const byGuide = new Map<string, any[]>();
    const byId = new Map<string, any>();
    for (const r of rows) {
      const d = byId.get(r.id) ?? {
        id: r.id,
        folio: r.folio,
        routeDay: r.routeDay,
        createdAt: new Date(r.createdAt),
        status: r.status,
        is315: !!Number(r.is315),
        subsidiaryName: r.sname ?? null,
        vehicle: [r.vehicleName, r.plateNumber].filter(Boolean).join(' · ') || null,
        routes: routeMap.get(r.id) ?? null,
        drivers: driverMap.get(r.id) ?? null,
        createdByName: r.createdById ? users.get(r.createdById) ?? null : null,
        closedAt: r.closedAt ? new Date(r.closedAt) : null,
        guideIds: [] as string[],
      };
      d.guideIds.push(r.gid);
      byId.set(r.id, d);
      const list = byGuide.get(r.gid) ?? [];
      list.push({ ...d, closureStatus: r.closureStatus ?? null, guideIds: undefined });
      byGuide.set(r.gid, list);
    }
    return { byGuide, dispatches: [...byId.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) };
  }

  private async unloadingsByIds(ids: string[]) {
    if (!ids.length) return [];
    const rows: any[] = await this.ds.query(
      `SELECT u.id, u.trackingNumber AS folio, u.date, u.createdAt, u.missingTrackings, u.unScannedTrackings, s.name AS sname, v.name AS vehicleName, v.plateNumber, u.createdById
       FROM unloading u LEFT JOIN subsidiary s ON s.id = u.subsidiaryId LEFT JOIN vehicle v ON v.id = u.vehicleId
       WHERE u.id IN (${ph(ids.length)})`,
      ids,
    );
    const users = await this.userNames(rows.map((r) => r.createdById));
    return rows.map((r) => ({
      id: r.id,
      folio: r.folio,
      at: new Date(r.date ?? r.createdAt),
      subsidiaryName: r.sname ?? null,
      vehicle: [r.vehicleName, r.plateNumber].filter(Boolean).join(' · ') || null,
      createdByName: r.createdById ? users.get(r.createdById) ?? null : null,
      /** Marcadas como "Guía faltante" al desembarcar (no llegaron). */
      missing: parseJsonList(r.missingTrackings).map((t) => t.trim()),
      /** Marcadas como "Guía sin escaneo" (llegaron pero no se pudieron escanear). */
      unscanned: parseJsonList(r.unScannedTrackings).map((t) => t.trim()),
    }));
  }

  // ───────────────────────── detalle de consolidado ─────────────────────────

  async consolidatedDetail(p: { id?: string; cons?: string; type?: HeadType }, scope: Scope) {
    let head: any = null;
    let type: HeadType = p.type === 'carga' ? 'carga' : 'paquete';
    const loadHead = async (t: HeadType, where: string, value: string) => {
      const [r]: any[] =
        t === 'carga'
          ? await this.ds.query(
              `SELECT h.id, TRIM(h.consNumber) AS consNumber, DATE_FORMAT(h.chargeDate, '%Y-%m-%d') AS day, h.createdAt, h.numberOfPackages AS declared, h.subsidiaryId, s.name AS sname, h.createdById, NULL AS carrier, h.isHalfTon, NULL AS consType
               FROM charge h LEFT JOIN subsidiary s ON s.id = h.subsidiaryId WHERE h.active = 1 AND ${where} = ? ORDER BY h.createdAt DESC LIMIT 1`,
              [value],
            )
          : await this.ds.query(
              `SELECT h.id, TRIM(h.consNumber) AS consNumber, DATE_FORMAT(h.date, '%Y-%m-%d') AS day, h.createdAt, h.numberOfPackages AS declared, h.subsidiaryId, s.name AS sname, h.createdById, h.carrier, NULL AS isHalfTon, h.type AS consType
               FROM consolidated h LEFT JOIN subsidiary s ON s.id = h.subsidiaryId WHERE h.active = 1 AND ${where} = ? ORDER BY h.createdAt DESC LIMIT 1`,
              [value],
            );
      return r ?? null;
    };
    if (p.id) {
      head = await loadHead(type, 'h.id', p.id);
      if (!head && !p.type) {
        type = 'carga';
        head = await loadHead(type, 'h.id', p.id);
      }
    } else if (p.cons) {
      head = await loadHead(type, 'TRIM(h.consNumber)', p.cons.trim());
      if (!head && !p.type) {
        type = 'carga';
        head = await loadHead(type, 'TRIM(h.consNumber)', p.cons.trim());
      }
    }
    if (!head || !this.inScope(head.subsidiaryId, scope)) throw new NotFoundException('No se encontró ese consolidado');

    const isCarga = type === 'carga';
    const gTable = isCarga ? 'charge_shipment' : 'shipment';
    const fk = isCarga ? 'chargeId' : 'consolidatedId';
    const statusCol = isCarga ? 'chargeShipmentId' : 'shipmentId';
    const guides: any[] = await this.ds.query(
      `SELECT g.id, TRIM(g.trackingNumber) AS tn, g.status, g.recipientName, g.recipientCity, g.recipientZip, g.commitDateTime, g.isHighValue, g.unloadingId, g.createdAt,
              (SELECT ss.exceptionCode FROM shipment_status ss WHERE ss.${statusCol} = g.id ORDER BY ss.timestamp DESC LIMIT 1) AS lastCode,
              (SELECT MAX(ss.timestamp) FROM shipment_status ss WHERE ss.${statusCol} = g.id) AS lastAt
       FROM ${gTable} g WHERE g.${fk} = ? AND g.active = 1
       ORDER BY g.trackingNumber`,
      [head.id],
    );
    const ids = guides.map((g) => g.id);
    const tns = guides.map((g) => g.tn);

    const [{ byGuide, dispatches }, incomes, devolutions, payments, other] = await Promise.all([
      this.dispatchesOf(type, ids),
      isCarga
        ? this.ds.query('SELECT NULL AS gid, SUM(cost) AS total, COUNT(*) AS n FROM income WHERE chargeId = ? AND active = 1', [head.id])
        : ids.length
          ? this.ds.query(`SELECT shipmentId AS gid, SUM(cost) AS total, COUNT(*) AS n FROM income WHERE shipmentId IN (${ph(ids.length)}) AND active = 1 GROUP BY shipmentId`, ids)
          : [],
      ids.length
        ? this.ds.query(
            `SELECT COALESCE(${statusCol}, '') AS gid, TRIM(trackingNumber) AS tn, date, reason, undoneAt FROM devolution WHERE ${statusCol} IN (${ph(ids.length)})${isCarga ? '' : ' OR consolidatedId = ?'}`,
            isCarga ? ids : [...ids, head.id],
          )
        : [],
      ids.length ? this.ds.query(`SELECT ${statusCol} AS gid, amount, type, status FROM payment WHERE ${statusCol} IN (${ph(ids.length)})`, ids) : [],
      // ¿Alguna guía también está en OTRO consolidado activo? (subida dos veces)
      tns.length
        ? this.ds.query(
            `SELECT TRIM(x.tn) AS tn, COUNT(*) AS n FROM (
               SELECT trackingNumber AS tn FROM shipment WHERE active = 1 AND trackingNumber IN (${ph(tns.length)}) AND id NOT IN (${ph(ids.length)})
               UNION ALL SELECT trackingNumber FROM charge_shipment WHERE active = 1 AND trackingNumber IN (${ph(tns.length)}) AND id NOT IN (${ph(ids.length)})
             ) x GROUP BY TRIM(x.tn)`,
            [...tns, ...ids, ...tns, ...ids],
          )
        : [],
    ]);
    const incomeBy = new Map<string, number>((incomes as any[]).map((r) => [r.gid ?? '', num(r.total)]));
    const devBy = new Map<string, any>();
    for (const d of devolutions as any[]) if (!d.undoneAt) devBy.set(d.gid || d.tn, d);
    const payBy = new Map<string, any>((payments as any[]).map((r) => [r.gid, r]));
    const otherBy = new Map<string, number>((other as any[]).map((r) => [r.tn, num(r.n)]));

    // Desembarques: los ligados a las guías + los que las anotaron como faltantes o sin escaneo.
    const linkedIds = [...new Set(guides.map((g) => g.unloadingId).filter(Boolean))] as string[];
    const tnSet = new Set(tns);
    let notedIds: string[] = [];
    if (tns.length) {
      const near: any[] = await this.ds.query(
        `SELECT id, missingTrackings, unScannedTrackings FROM unloading WHERE subsidiaryId = ? AND createdAt BETWEEN ? AND ?`,
        [head.subsidiaryId, new Date(new Date(head.createdAt).getTime() - 86_400_000), new Date(new Date(head.createdAt).getTime() + 10 * 86_400_000)],
      );
      notedIds = near
        .filter((u) => [...parseJsonList(u.missingTrackings), ...parseJsonList(u.unScannedTrackings)].some((t) => tnSet.has(t.trim())))
        .map((u) => u.id);
    }
    const unloadingRows = await this.unloadingsByIds([...new Set([...linkedIds, ...notedIds])]);
    // Lo demás que se escaneó en esos desembarques (otros consolidados o sobrantes sin consolidado).
    const uIds = unloadingRows.map((u) => u.id);
    const others: any[] = uIds.length
      ? await this.ds.query(
          `SELECT x.unloadingId, x.cons, COUNT(*) AS n FROM (
             SELECT g.unloadingId, TRIM(h.consNumber) AS cons, g.id FROM shipment g LEFT JOIN consolidated h ON h.id = g.consolidatedId
             WHERE g.active = 1 AND g.unloadingId IN (${ph(uIds.length)}) AND (g.consolidatedId IS NULL OR g.consolidatedId <> ?)
             UNION ALL
             SELECT g.unloadingId, TRIM(h.consNumber), g.id FROM charge_shipment g LEFT JOIN charge h ON h.id = g.chargeId
             WHERE g.active = 1 AND g.unloadingId IN (${ph(uIds.length)}) AND (g.chargeId IS NULL OR g.chargeId <> ?)
           ) x GROUP BY x.unloadingId, x.cons`,
          [...uIds, head.id, ...uIds, head.id],
        )
      : [];
    const unloadings = unloadingRows
      .map((u) => {
        const mine = others.filter((o) => o.unloadingId === u.id);
        const noted = [...u.missing, ...u.unscanned];
        return {
          id: u.id,
          folio: u.folio,
          at: u.at,
          subsidiaryName: u.subsidiaryName,
          vehicle: u.vehicle,
          createdByName: u.createdByName,
          scannedFromThis: guides.filter((g) => g.unloadingId === u.id).length,
          missingFromThis: u.missing.filter((t) => tnSet.has(t)),
          unscannedFromThis: u.unscanned.filter((t) => tnSet.has(t)),
          /** Anotadas en ese desembarque que no son de este consolidado. */
          notedOther: noted.filter((t) => !tnSet.has(t)).slice(0, 200),
          /** Escaneadas en ese mismo desembarque de OTROS consolidados. */
          otherConsolidations: mine.filter((o) => o.cons).map((o) => ({ consNumber: o.cons, count: num(o.n) })),
          /** Escaneadas sin consolidado (sobrantes dados de alta a mano). */
          surplus: mine.filter((o) => !o.cons).reduce((acc, o) => acc + num(o.n), 0),
        };
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const unloadingById = new Map(unloadingRows.map((u) => [u.id, u]));

    const now = new Date();
    const guideRows = guides.map((g) => {
      const disp = byGuide.get(g.id) ?? [];
      const last = disp[disp.length - 1] ?? null;
      const income = isCarga ? null : incomeBy.get(g.id) ?? 0;
      const dev = devBy.get(g.id) ?? devBy.get(g.tn) ?? null;
      const unloaded = !!g.unloadingId;
      const routed = disp.length > 0;
      const closed = disp.some((d) => !!d.closedAt);
      const commit = g.commitDateTime ? new Date(g.commitDateTime) : null;
      const pay = payBy.get(g.id);
      return {
        id: g.id,
        trackingNumber: g.tn,
        status: g.status,
        bucket: bucketOf(g.status),
        dexCode: dexCode(g.status, g.lastCode),
        recipientName: g.recipientName ?? null,
        recipientCity: g.recipientCity ?? null,
        recipientZip: g.recipientZip ?? null,
        commitDateTime: commit,
        isHighValue: !!Number(g.isHighValue),
        lastEventAt: g.lastAt ? new Date(g.lastAt) : null,
        unloadingFolio: g.unloadingId ? unloadingById.get(g.unloadingId)?.folio ?? null : null,
        unloadedAt: g.unloadingId ? unloadingById.get(g.unloadingId)?.at ?? null : null,
        dispatchFolio: last?.folio ?? null,
        routeDay: last?.routeDay ?? null,
        routes: last?.routes ?? null,
        drivers: last?.drivers ?? null,
        dispatchCount: disp.length,
        closed,
        income,
        payment: pay ? { amount: Number(pay.amount), type: pay.type, status: pay.status } : null,
        devolution: dev ? { date: new Date(dev.date), reason: dev.reason } : null,
        insights: guideInsights(
          { status: g.status, unloaded, routed, closed, income, devolved: !!dev, commitDateTime: commit, isHighValue: !!Number(g.isHighValue), otherRecords: otherBy.get(g.tn) ?? 0 },
          now,
        ),
      };
    });

    // Correo(s) donde llegó y cuándo se anunció.
    const [announcing, byGuides, announced] = await Promise.all([
      this.emailsAnnouncing(head.consNumber, scope),
      this.emailsWithGuides(tns, scope, { minGuides: Math.min(3, Math.max(1, tns.length)), around: new Date(head.createdAt) }),
      this.ds.query(
        `SELECT consNumber, kind, announcedCount, receivedAt, uploadedAt, uploadMinutes, linkStatus FROM inbox_consolidation WHERE (consNumber = ? OR uploadedAs = ?) AND linkStatus <> 'no_aplica' ORDER BY receivedAt LIMIT 1`,
        [head.consNumber, head.consNumber],
      ),
    ]);
    const ann: any = (announced as any[])[0] ?? null;
    const emails = this.mergeEmails(announcing, byGuides);
    const receivedAt: Date | null = ann?.receivedAt ? new Date(ann.receivedAt) : emails.length ? emails[emails.length - 1].receivedAt : null;

    const facts: GuideFact[] = guideRows.map((g) => ({ trackingNumber: g.trackingNumber, status: g.status, unloaded: !!g.unloadingFolio, routed: g.dispatchCount > 0, closed: g.closed }));
    const findings = analyzeConsolidated({ receivedAt: receivedAt ?? new Date(head.createdAt), announcedCount: ann?.announcedCount ?? null, guides: facts, now });

    const users = await this.userNames([head.createdById]);
    const buckets = countBuckets(guideRows.map((g) => g.status));
    const dexByCode: Record<string, number> = {};
    for (const g of guideRows) if (g.dexCode) dexByCode[g.dexCode] = (dexByCode[g.dexCode] ?? 0) + 1;
    const chargeIncome = isCarga ? incomeBy.get('') ?? 0 : null;

    return {
      head: {
        id: head.id,
        consNumber: head.consNumber,
        type,
        consType: head.consType ?? null,
        carrier: head.carrier ?? null,
        isHalfTon: head.isHalfTon == null ? null : !!Number(head.isHalfTon),
        day: head.day,
        createdAt: new Date(head.createdAt),
        createdByName: head.createdById ? users.get(head.createdById) ?? null : null,
        subsidiaryName: head.sname ?? null,
        declared: head.declared == null ? null : num(head.declared),
        announcedCount: ann?.announcedCount ?? null,
        receivedAt,
        uploadMinutes: ann?.uploadMinutes ?? null,
      },
      summary: {
        total: guideRows.length,
        unloaded: guideRows.filter((g) => !!g.unloadingFolio).length,
        notUnloaded: guideRows.filter((g) => !g.unloadingFolio).length,
        routed: guideRows.filter((g) => g.dispatchCount > 0).length,
        closed: guideRows.filter((g) => g.closed).length,
        ...buckets,
        dexByCode,
        devolutions: guideRows.filter((g) => !!g.devolution).length,
        income: isCarga ? chargeIncome : guideRows.reduce((s, g) => s + (g.income ?? 0), 0),
        cod: guideRows.reduce((s, g) => s + (g.payment?.amount ?? 0), 0),
        withIssues: guideRows.filter((g) => g.insights.some((i) => i.severity === 'alta')).length,
      },
      findings,
      emails,
      unloadings,
      dispatches: dispatches.map((d) => {
        const mine = guideRows.filter((g) => d.guideIds.includes(g.id));
        return { ...d, guideIds: undefined, count: mine.length, delivered: mine.filter((g) => g.bucket === 'entregado').length, dex: mine.filter((g) => g.bucket === 'dex').length };
      }),
      guides: guideRows,
    };
  }

  // ───────────────────────── detalle de guía ─────────────────────────

  async guideDetail(rawTracking: string, scope: Scope) {
    const tracking = cleanTracking(rawTracking);
    if (!tracking) throw new BadRequestException('Esa guía no es válida');
    const recs = await this.guideRecords(tracking, scope);
    const emailsDirect = await this.emailsWithGuides([tracking], scope);
    if (!recs.length && !emailsDirect.length) throw new NotFoundException('No se encontró esa guía');

    const now = new Date();
    const records = [];
    for (const r of recs) {
      const isCarga = r.type === 'carga';
      const table = isCarga ? 'charge_shipment' : 'shipment';
      const col = isCarga ? 'chargeShipmentId' : 'shipmentId';
      const [g]: any[] = await this.ds.query(
        `SELECT g.*, ${isCarga ? 'NULL AS dhlUniqueId,' : ''} DATE_FORMAT(${isCarga ? 'h.chargeDate' : 'h.date'}, '%Y-%m-%d') AS consDay FROM ${table} g LEFT JOIN ${isCarga ? 'charge' : 'consolidated'} h ON h.id = g.${isCarga ? 'chargeId' : 'consolidatedId'} WHERE g.id = ?`,
        [r.id],
      );
      const [history, { byGuide }, incomes, devs, pays, unl, users] = await Promise.all([
        this.ds.query(`SELECT status, exceptionCode, timestamp, notes FROM shipment_status WHERE ${col} = ? ORDER BY timestamp DESC, createdAt DESC LIMIT 100`, [r.id]),
        this.dispatchesOf(r.type, [r.id]),
        isCarga
          ? this.ds.query('SELECT date, cost, incomeType, sourceType, active FROM income WHERE chargeId = ? ORDER BY date', [r.headId])
          : this.ds.query('SELECT date, cost, incomeType, sourceType, active FROM income WHERE shipmentId = ? ORDER BY date', [r.id]),
        this.ds.query(`SELECT date, reason, undoneAt FROM devolution WHERE ${col} = ? OR (trackingNumber = ? AND ${col} IS NULL AND createdAt >= ?) ORDER BY date`, [r.id, tracking, r.createdAt]),
        this.ds.query(`SELECT amount, type, status FROM payment WHERE ${col} = ?`, [r.id]),
        g?.unloadingId ? this.unloadingsByIds([g.unloadingId]) : Promise.resolve([]),
        this.userNames([g?.createdById ?? null]),
      ]);
      const dispatches = byGuide.get(r.id) ?? [];
      const activeIncome = (incomes as any[]).filter((i) => Number(i.active) === 1).reduce((s, i) => s + Number(i.cost ?? 0), 0);
      const dev = (devs as any[]).find((d) => !d.undoneAt) ?? null;
      const commit = g?.commitDateTime ? new Date(g.commitDateTime) : null;
      const insights: Insight[] = guideInsights(
        {
          status: r.status,
          unloaded: !!g?.unloadingId,
          routed: dispatches.length > 0,
          closed: dispatches.some((d) => !!d.closedAt),
          income: isCarga ? null : activeIncome,
          devolved: !!dev,
          commitDateTime: commit,
          isHighValue: !!Number(g?.isHighValue),
          otherRecords: recs.length - 1,
        },
        now,
      );
      const lastCode = (history as any[])[0]?.exceptionCode ?? null;
      records.push({
        id: r.id,
        type: r.type as HeadType,
        trackingNumber: r.trackingNumber,
        dhlUniqueId: g?.dhlUniqueId ?? null,
        carrier: r.carrierCode ?? null,
        status: r.status,
        bucket: bucketOf(r.status),
        dexCode: dexCode(r.status, lastCode),
        subsidiaryName: r.sname,
        consolidated: r.headId ? { id: r.headId, consNumber: r.consNumber, day: g?.consDay ?? null } : null,
        recipient: {
          name: g?.recipientName ?? null,
          address: g?.recipientAddress ?? null,
          city: g?.recipientCity ?? null,
          zip: g?.recipientZip ?? null,
          phone: g?.recipientPhone ?? null,
          receivedBy: g?.receivedByName ?? null,
        },
        commitDateTime: commit,
        isHighValue: !!Number(g?.isHighValue),
        createdAt: new Date(r.createdAt),
        createdByName: g?.createdById ? users.get(g.createdById) ?? null : null,
        unloading: (unl as any[])[0] ? { ...(unl as any[])[0], missing: undefined, unscanned: undefined } : null,
        dispatches,
        history: (history as any[]).map((h) => ({ status: h.status, exceptionCode: h.exceptionCode || null, at: new Date(h.timestamp), notes: h.notes || null })),
        incomes: (incomes as any[]).map((i) => ({ date: new Date(i.date), cost: Number(i.cost ?? 0), incomeType: i.incomeType, sourceType: i.sourceType, active: Number(i.active) === 1 })),
        incomeTotal: isCarga ? null : activeIncome,
        devolutions: (devs as any[]).map((d) => ({ date: new Date(d.date), reason: d.reason, undone: !!d.undoneAt })),
        payment: (pays as any[])[0] ? { amount: Number((pays as any[])[0].amount), type: (pays as any[])[0].type, status: (pays as any[])[0].status } : null,
        insights,
      });
    }

    const fromCons = (await Promise.all([...new Set(recs.map((r) => r.consNumber).filter(Boolean))].map((c: string) => this.emailsAnnouncing(c, scope)))).flat();
    const emails = this.mergeEmails(emailsDirect, fromCons.map((e) => ({ ...e, where: `${e.where} (consolidado de la guía)` })));
    return { trackingNumber: tracking, records, emails };
  }
}
