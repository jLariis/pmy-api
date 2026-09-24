import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FedexService } from 'src/shipments/fedex.service';
import { ChargeRulesService } from 'src/charge-rules/charge-rules.service';
import { DELIVERED_CODE } from 'src/common/income-rules.util';
import { effectiveLocalDay } from 'src/common/income-window.util';
import { toHermosilloDateString } from 'src/common/utils';
import { extractFedexDayOutcome, selectLatestGeneration } from '../logic/fedex-day-outcome.util';
import { diagnoseGuide, summarize } from '../logic/manual-count-diagnose.util';
import { pickShipmentRowForDay } from '../logic/manual-count-facts.util';
import { buildManualCountPrompt } from '../logic/manual-count-prompt.util';
import {
  Cause,
  DayOutcome,
  FedexLive,
  GuideFacts,
  IncomeRef,
  ManualCountReport,
  ManualLists,
  Mark,
  RouteRef,
} from '../logic/manual-count.types';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FEDEX_BLOCK = 25;
const FEDEX_PARALLEL = 3;
const CACHE_TTL_MS = 15 * 60 * 1000;
const OFFSET_H = 7; // Hermosillo = UTC-7 fijo

/** Guía en caché: los trackResults crudos (el desenlace depende del día consultado). */
interface CachedTrack {
  at: number;
  ok: boolean;
  results: any[];
}

const clean = (list: string[]) => [...new Set((list ?? []).map((t) => String(t).trim()).filter(Boolean))];
const inList = (n: number) => Array(n).fill('?').join(',');

/**
 * "Conteo manual vs sistema": junta por lotes los hechos de cada guía (existencia,
 * consolidado, rutas, estatus, ingresos, devoluciones, bodega, traspasos) + FedEx en vivo,
 * y delega el diagnóstico al util puro. Read-only: nunca escribe en BD.
 */
@Injectable()
export class ManualCountService {
  private readonly logger = new Logger(ManualCountService.name);
  private static readonly cache = new Map<string, CachedTrack>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly fedex: FedexService,
    private readonly chargeRules: ChargeRulesService,
  ) {}

  /** Precalienta la caché FedEx de un bloque (≤25 guías = 1 llamada a FedEx). */
  async prefetchFedex(trackingNumbers: string[]): Promise<{ done: number; failed: number }> {
    const tns = clean(trackingNumbers).slice(0, FEDEX_BLOCK);
    await this.fetchBlock(tns.filter((tn) => !this.cached(tn)));
    const failed = tns.filter((tn) => !this.cached(tn)?.ok).length;
    return { done: tns.length, failed };
  }

  async diagnose(subsidiaryId: string, day: string, lists: ManualLists): Promise<ManualCountReport> {
    if (!DAY_RE.test(day)) throw new BadRequestException('La fecha debe tener el formato AAAA-MM-DD.');

    const manual = new Map<string, Mark>();
    // Si una guía viene en varias cajas, gana la última (POD < 07 < 08); el front ya avisa.
    for (const [mark, list] of [['POD', lists.pod], ['07', lists.dex07], ['08', lists.dex08]] as [Mark, string[]][]) {
      for (const tn of clean(list)) manual.set(tn, mark);
    }

    const subRow = await this.dataSource.query(`SELECT name, fedexCostPackage FROM subsidiary WHERE id = ? LIMIT 1`, [subsidiaryId]);
    if (!subRow?.length) throw new BadRequestException('La sucursal no existe.');
    const subsidiaryName: string | null = subRow[0].name ?? null;
    const expectedCost = Number(subRow[0].fedexCostPackage ?? 0);

    const universe = new Set<string>([...manual.keys(), ...(await this.systemUniverse(subsidiaryId, day))]);
    const tns = [...universe];
    const facts = await this.loadFacts(subsidiaryId, day, tns);

    await this.ensureFedex(tns.filter((tn) => facts.get(tn)?.kind));
    let fedexFailures = 0;
    for (const tn of tns) {
      const f = facts.get(tn)!;
      if (!f.kind) continue;
      const c = this.cached(tn);
      const live: FedexLive = c?.ok
        ? extractFedexDayOutcome(selectLatestGeneration(c.results), day)
        : { ok: false, outcome: null, outcomeAt: null, dex08Dates: [], lastCode: null, latestOutcome: null, deliveredDay: null };
      if (!live.ok) fedexFailures++;
      f.fedex = live;
    }

    const resolver = await this.chargeRules.buildResolver(subsidiaryId);
    const ctx = {
      day,
      subsidiaryId,
      expectedCost,
      isChargeable: (code: 'DELIVERED' | '07' | '08') => resolver.isChargeable('fedex', code === 'DELIVERED' ? DELIVERED_CODE : code) ?? true,
    };

    const isMark = (o: DayOutcome) => o === 'POD' || o === '07' || o === '08';
    const rows = tns
      // Cargas F2 se cuentan aparte (por carga): solo entran si el usuario las contó.
      .filter((tn) => manual.has(tn) || facts.get(tn)!.kind !== 'charge')
      .map((tn) => diagnoseGuide(manual.get(tn) ?? null, facts.get(tn)!, ctx))
      // Del universo del sistema solo interesan las guías con algo que comparar.
      .filter((r) => r.manual || r.charged.length || isMark(r.fedexSays) || (!r.fedexSays && isMark(r.systemSays)))
      .sort((a, b) => a.trackingNumber.localeCompare(b.trackingNumber));

    return { subsidiaryId, subsidiaryName, day, fedexFailures, totals: summarize(rows), rows };
  }

  async prompt(subsidiaryId: string, day: string, lists: ManualLists, causes: Cause[] | undefined): Promise<{ prompt: string }> {
    const report = await this.diagnose(subsidiaryId, day, lists);
    const present = [...new Set(report.rows.filter((r) => r.verdict === 'ERROR_SISTEMA' && r.cause).map((r) => r.cause!))];
    return { prompt: buildManualCountPrompt({ report, causes: causes?.length ? causes : present }) };
  }

  // ───────────────────────── universo y hechos ─────────────────────────

  /** Ventana UTC del día local Hermosillo: [día 07:00Z, día+1 07:00Z). */
  private dayWindow(day: string): { start: Date; end: Date } {
    const start = new Date(`${day}T0${OFFSET_H}:00:00.000Z`);
    return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
  }

  /** Guías del sistema con ingreso, desenlace o ruta ese día en la sucursal. */
  private async systemUniverse(subsidiaryId: string, day: string): Promise<string[]> {
    const { start, end } = this.dayWindow(day);
    const rows = await this.dataSource.query(
      `SELECT i.trackingNumber AS tn FROM income i
        WHERE i.subsidiaryId = ? AND i.active = 1 AND i.sourceType = 'shipment' AND i.shipmentType = 'fedex'
          AND i.date >= ? AND i.date < ? AND i.trackingNumber IS NOT NULL
       UNION
       SELECT s.trackingNumber FROM shipment s JOIN shipment_status ss ON ss.shipmentId = s.id
        WHERE s.subsidiaryId = ? AND LOWER(s.shipmentType) = 'fedex' AND ss.timestamp >= ? AND ss.timestamp < ?
          AND (LOWER(ss.status) IN ('entregado','entregado_en_bodega','rechazado') OR ss.exceptionCode IN ('07','08'))
       UNION
       SELECT wd.trackingNumber FROM warehouse_delivery wd
        WHERE wd.subsidiaryId = ? AND wd.date >= ? AND wd.date < ?
       UNION
       SELECT COALESCE(s.trackingNumber, cs.trackingNumber) FROM package_dispatch pd
         JOIN package_dispatch_history h ON h.dispatchId = pd.id
         LEFT JOIN shipment s ON s.id = h.shipmentId
         LEFT JOIN charge_shipment cs ON cs.id = h.chargeShipmentId
        WHERE pd.subsidiaryId = ? AND pd.routeDate = ?`,
      [subsidiaryId, start, end, subsidiaryId, start, end, subsidiaryId, start, end, subsidiaryId, day],
    );
    return rows.map((r: any) => r.tn).filter(Boolean).map(String);
  }

  private async loadFacts(subsidiaryId: string, day: string, tns: string[]): Promise<Map<string, GuideFacts>> {
    const out = new Map<string, GuideFacts>();
    for (const tn of tns) {
      out.set(tn, {
        trackingNumber: tn, kind: null, subsidiaryId: null, transferredIn: false, consolidado: null, routes: [],
        systemStatus: null, systemOutcome: null, systemDex08Dates: [], fedex: null, incomes: [], returned: false, warehouseDelivered: false,
      });
    }
    if (!tns.length) return out;
    const ph = inList(tns.length);
    const { start, end } = this.dayWindow(day);

    // Guía (envío o carga F2). Una guía puede tener varias filas (reciclada / devolución):
    // se prefiere la de la sucursal y la más reciente.
    const shipRows = await this.dataSource.query(
      `SELECT s.id, s.trackingNumber AS tn, s.subsidiaryId, s.status, s.createdAt,
              c.id AS consId, c.consNumber, DATE(c.date) AS consDay, 'shipment' AS kind
         FROM shipment s LEFT JOIN consolidated c ON c.id = s.consolidatedId
        WHERE s.trackingNumber IN (${ph})
       UNION ALL
       SELECT cs.id, cs.trackingNumber, cs.subsidiaryId, cs.status, cs.createdAt,
              ch.id, ch.consNumber, DATE(ch.chargeDate), 'charge'
         FROM charge_shipment cs LEFT JOIN charge ch ON ch.id = cs.chargeId
        WHERE cs.trackingNumber IN (${ph})`,
      [...tns, ...tns],
    );

    // Varias filas por guía (reingreso / reciclada / F2): se usa la vigente ese día, pero
    // las rutas y eventos se juntan de TODAS sus filas.
    const rowsByTn = new Map<string, any[]>();
    for (const r of shipRows) {
      const tn = String(r.tn);
      const consDay = r.consDay ? toDayString(r.consDay) : null;
      rowsByTn.set(tn, [...(rowsByTn.get(tn) ?? []), { ...r, id: String(r.id), consDay }]);
    }
    const chosen = new Map<string, any>();
    for (const [tn, rows] of rowsByTn) chosen.set(tn, pickShipmentRowForDay(rows, subsidiaryId, day));
    for (const [tn, r] of chosen) {
      const f = out.get(tn)!;
      f.kind = r.kind;
      f.shipmentId = r.kind === 'shipment' ? r.id : null;
      f.subsidiaryId = r.subsidiaryId ?? null;
      f.systemStatus = r.status ?? null;
      // Envío: el consolidado registrado. Carga F2: la carga misma hace de constancia.
      f.consolidado = r.consId ? { consNumber: r.consNumber ?? null, day: r.consDay } : null;
    }

    const allRows = [...rowsByTn.values()].flat();
    const shipmentIds = allRows.filter((r) => r.kind === 'shipment').map((r) => r.id);
    const chargeIds = allRows.filter((r) => r.kind === 'charge').map((r) => r.id);
    const tnByShipment = new Map(allRows.map((r) => [r.id, String(r.tn)]));

    // Rutas (historial, no la relación viva).
    if (shipmentIds.length || chargeIds.length) {
      const conds: string[] = [];
      const params: any[] = [];
      if (shipmentIds.length) { conds.push(`h.shipmentId IN (${inList(shipmentIds.length)})`); params.push(...shipmentIds); }
      if (chargeIds.length) { conds.push(`h.chargeShipmentId IN (${inList(chargeIds.length)})`); params.push(...chargeIds); }
      const routeRows = await this.dataSource.query(
        `SELECT DISTINCT COALESCE(h.shipmentId, h.chargeShipmentId) AS ownerId, pd.id AS dispatchId, pd.trackingNumber AS folio,
                pd.routeDate, pd.createdAt, pd.is315, pd.status,
                (SELECT 1 FROM route_closure rc WHERE rc.package_dispatch_id = pd.id LIMIT 1) AS hasClosure
           FROM package_dispatch_history h JOIN package_dispatch pd ON pd.id = h.dispatchId
          WHERE ${conds.join(' OR ')}`,
        params,
      );
      for (const r of routeRows) {
        const tn = tnByShipment.get(String(r.ownerId));
        if (!tn) continue;
        const ref: RouteRef = {
          dispatchId: String(r.dispatchId),
          folio: r.folio ?? null,
          routeDay: r.routeDate ? toDayString(r.routeDate) : r.createdAt ? toHermosilloDateString(new Date(r.createdAt)) : null,
          is315: Number(r.is315) === 1,
          closed: Number(r.hasClosure) === 1 || String(r.status ?? '').toLowerCase() === 'completada',
        };
        const f = out.get(tn)!;
        if (!f.routes.some((x) => x.dispatchId === ref.dispatchId)) f.routes.push(ref);
      }
    }

    // Estatus del sistema: desenlace del día + todos los 08.
    if (shipmentIds.length) {
      const evRows = await this.dataSource.query(
        `SELECT ss.shipmentId, ss.status, ss.exceptionCode, ss.timestamp
           FROM shipment_status ss
          WHERE ss.shipmentId IN (${inList(shipmentIds.length)})
            AND ((ss.timestamp >= ? AND ss.timestamp < ?) OR ss.exceptionCode = '08')`,
        [...shipmentIds, start, end],
      );
      const dayMarks = new Map<string, Set<string>>();
      const dayLast = new Map<string, { at: number; status: string }>();
      for (const r of evRows) {
        const tn = tnByShipment.get(String(r.shipmentId));
        if (!tn) continue;
        const f = out.get(tn)!;
        const ts = new Date(r.timestamp);
        const code = String(r.exceptionCode ?? '').trim();
        if (code === '08') f.systemDex08Dates.push(ts.toISOString());
        if (ts >= start && ts < end) {
          const st = String(r.status ?? '').toLowerCase();
          const m = st === 'entregado' || st === 'entregado_en_bodega' ? 'POD' : code === '07' || st === 'rechazado' ? '07' : code === '08' ? '08' : 'OTRO';
          const prev = dayLast.get(tn);
          if (!prev || ts.getTime() >= prev.at) dayLast.set(tn, { at: ts.getTime(), status: String(r.status ?? '') });
          const set = dayMarks.get(tn) ?? new Set<string>();
          set.add(m);
          dayMarks.set(tn, set);
        }
      }
      for (const [tn, last] of dayLast) out.get(tn)!.systemDayStatus = last.status || null;
      for (const [tn, set] of dayMarks) {
        out.get(tn)!.systemOutcome = (['POD', '07', '08', 'OTRO'] as const).find((m) => set.has(m)) ?? null;
      }
    }

    // Ingresos de envío ±7 días (para detectar "ingreso en otro día").
    const incRows = await this.dataSource.query(
      `SELECT i.id, i.trackingNumber AS tn, i.incomeType, i.nonDeliveryStatus, i.date, i.cost, i.active, i.sourceType
         FROM income i
        WHERE i.trackingNumber IN (${ph}) AND i.sourceType = 'shipment' AND i.subsidiaryId = ?
          AND i.date >= ? AND i.date < ?`,
      [...tns, subsidiaryId, new Date(start.getTime() - 7 * 86400000), new Date(end.getTime() + 7 * 86400000)],
    );
    for (const r of incRows) {
      const f = out.get(String(r.tn));
      if (!f) continue;
      const it = String(r.incomeType ?? '').toLowerCase();
      const nds = String(r.nonDeliveryStatus ?? '').trim();
      const mark: Mark | null = it === 'entregado' ? 'POD' : nds === '07' || nds === '08' ? nds : null;
      const ref: IncomeRef = {
        id: String(r.id),
        mark,
        day: effectiveLocalDay({ sourceType: r.sourceType, date: new Date(r.date) }),
        cost: Number(r.cost ?? 0),
        active: Number(r.active) === 1,
      };
      f.incomes.push(ref);
    }

    // Devolución (ese día o después), entregado en bodega (ese día), traspaso hacia la sucursal.
    const [devRows, whRows, trRows] = await Promise.all([
      this.dataSource.query(`SELECT DISTINCT trackingNumber AS tn FROM devolution WHERE trackingNumber IN (${ph}) AND date >= ?`, [...tns, start]),
      this.dataSource.query(`SELECT DISTINCT trackingNumber AS tn FROM warehouse_delivery WHERE trackingNumber IN (${ph}) AND date >= ? AND date < ?`, [...tns, start, end]),
      this.dataSource.query(`SELECT DISTINCT trackingNumber AS tn FROM package_transfer WHERE trackingNumber IN (${ph}) AND destinationId = ?`, [...tns, subsidiaryId]),
    ]);
    for (const r of devRows) out.get(String(r.tn))!.returned = true;
    for (const r of whRows) out.get(String(r.tn))!.warehouseDelivered = true;
    for (const r of trRows) out.get(String(r.tn))!.transferredIn = true;

    return out;
  }

  // ───────────────────────── FedEx ─────────────────────────

  private cached(tn: string): CachedTrack | undefined {
    const c = ManualCountService.cache.get(tn);
    if (!c) return undefined;
    if (Date.now() - c.at > CACHE_TTL_MS) {
      ManualCountService.cache.delete(tn);
      return undefined;
    }
    return c;
  }

  /** Consulta FedEx lo que no esté en caché, en bloques de 25 con 3 bloques a la vez. */
  private async ensureFedex(tns: string[]): Promise<void> {
    const missing = tns.filter((tn) => !this.cached(tn));
    const blocks: string[][] = [];
    for (let i = 0; i < missing.length; i += FEDEX_BLOCK) blocks.push(missing.slice(i, i + FEDEX_BLOCK));
    for (let i = 0; i < blocks.length; i += FEDEX_PARALLEL) {
      await Promise.all(blocks.slice(i, i + FEDEX_PARALLEL).map((b) => this.fetchBlock(b)));
    }
  }

  private async fetchBlock(tns: string[]): Promise<void> {
    if (!tns.length) return;
    try {
      const map = await this.fedex.trackBatch(tns.map((trackingNumber) => ({ trackingNumber })), 'manual-count');
      for (const tn of tns) {
        const results = (map.get(tn) ?? []).filter((r: any) => !r?.error);
        ManualCountService.cache.set(tn, { at: Date.now(), ok: results.length > 0, results });
      }
    } catch (e: any) {
      // FedEx caído: no se cachea el fallo (se reintenta en la siguiente comparación).
      this.logger.warn(`[ManualCount] FedEx falló para un bloque de ${tns.length}: ${e?.message}`);
    }
  }
}

/** 'YYYY-MM-DD' de una columna DATE / día-solo (sin corrimiento de zona). */
function toDayString(v: any): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return d.toISOString().slice(0, 10);
}
