import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { classifyLd, herDay, LdState } from '../common/ld-rule.util';
import { addDays, atLocalTime } from '../ops-alerts/ops-alerts.util';
import { ConsolidatedFacts, Progress, SubsidiaryDayFacts } from './daily-task.types';
import { pieceKeyOf } from './daily-task-rules.util';
import { dexCodeOf, isDexStatus, PackageSummary, summarizePackages } from './package-summary.util';

type Queryable = Pick<DataSource, 'query'>;
type Kind = 'master' | 'f2';

/** Tablas por tipo de consolidado: master/aéreo/DHL → consolidated/shipment; F2 → charge/charge_shipment. */
const K = {
  master: { head: 'consolidated', guides: 'shipment', headCol: 'consolidatedId', fk: 'shipmentId', inv: 'inventory_shipment', refType: 'consolidated' as const },
  f2: { head: 'charge', guides: 'charge_shipment', headCol: 'chargeId', fk: 'chargeShipmentId', inv: 'inventory_charge_shipments', refType: 'charge' as const },
};

const FINAL_WITHOUT_ROUTE = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega', 'devuelto_a_fedex', 'retorno_abandono_fedex', 'es_ocurre']);
const DELIVERED = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega']);

type Guide = { id: string; headId: string; trackingNumber: string; dhlUniqueId: string | null; status: string; unAt: Date | null; unBy: string | null; commitDateTime: Date | null; exceptionCode: string | null; consNumber: string };
type DispatchAgg = { first: Date; last: Date; lastBy: string | null; n: number; closed: number; closedAt: Date | null; closedBy: string | null };
type DevAgg = { at: Date; by: string | null };

const toDate = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const ph = (n: number) => Array(n).fill('?').join(',');
const chunk = <T>(a: T[], n = 800): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const dayRange = (day: string): [Date, Date] => [atLocalTime(day, '00:00'), atLocalTime(addDays(day, 1), '00:00')];

/**
 * Lee de la operación real lo que ya se hizo (solo lectura): consultas agrupadas por lote,
 * nunca por guía. Despacho y cierre salen de `package_dispatch_history` (no de la FK viva).
 */
@Injectable()
export class DailyTaskFactsService {
  constructor(private readonly ds: DataSource) {}

  private get db(): Queryable {
    return this.ds;
  }

  async consolidatedFacts(subsidiaryId: string, day: string): Promise<ConsolidatedFacts[]> {
    const [from, to] = dayRange(day);
    const masters: any[] = await this.db.query(
      `SELECT c.id, TRIM(c.consNumber) consNumber, c.carrier, c.type, c.createdAt, c.createdById, u.name byName
       FROM consolidated c LEFT JOIN \`user\` u ON u.id = c.createdById
       WHERE c.subsidiaryId = ? AND c.active = 1 AND c.date >= ? AND c.date < ?`,
      [subsidiaryId, from, to],
    );
    // charge.chargeDate es medianoche LOCAL guardada como 00:00Z: se compara tal cual.
    const f2s: any[] = await this.db.query(
      `SELECT ch.id, TRIM(ch.consNumber) consNumber, 'fedex' carrier, 'F2' type, ch.createdAt, ch.createdById, u.name byName
       FROM charge ch LEFT JOIN \`user\` u ON u.id = ch.createdById
       WHERE ch.subsidiaryId = ? AND ch.active = 1 AND ch.chargeDate >= ? AND ch.chargeDate < ?`,
      [subsidiaryId, new Date(`${day}T00:00:00.000Z`), new Date(`${addDays(day, 1)}T00:00:00.000Z`)],
    );
    const out: ConsolidatedFacts[] = [];
    for (const [kind, heads] of [['master', masters], ['f2', f2s]] as [Kind, any[]][]) {
      if (!heads.length) continue;
      const guides = await this.guidesOf(kind, heads.map((h) => h.id));
      const disp = await this.dispatchAgg(kind, guides.map((g) => g.id));
      const devs = await this.devolutionAgg(kind, guides, subsidiaryId);
      const names = await this.userNames([...guides.map((g) => g.unBy), ...[...disp.values()].flatMap((d) => [d.lastBy, d.closedBy]), ...[...devs.values()].map((d) => d.by)]);
      for (const h of heads) {
        const gs = guides.filter((g) => g.headId === h.id);
        out.push({
          refType: K[kind].refType, refId: h.id, consNumber: h.consNumber ?? '', day, carrier: h.carrier ?? 'fedex', type: h.type ?? '', guides: gs.length,
          uploadedAt: new Date(h.createdAt), uploadedById: h.createdById ?? null, uploadedByName: h.byName ?? null,
          ...this.progressOf(gs, disp, devs, names),
        });
      }
    }
    return out;
  }

  private progressOf(gs: Guide[], disp: Map<string, DispatchAgg>, devs: Map<string, DevAgg>, names: Map<string, string>) {
    const prog = (items: { at: Date | null; by: string | null }[], total: number): Progress => {
      const ats = items.filter((i) => i.at) as { at: Date; by: string | null }[];
      const lastItem = ats.reduce<{ at: Date; by: string | null } | null>((a, b) => (!a || b.at > a.at ? b : a), null);
      return {
        done: items.length, total,
        first: ats.length ? new Date(Math.min(...ats.map((i) => i.at.getTime()))) : null,
        last: lastItem?.at ?? null, lastById: lastItem?.by ?? null, lastByName: lastItem?.by ? names.get(lastItem.by) ?? null : null,
      };
    };
    const unloaded = gs.filter((g) => g.unAt);
    // Lo que terminó sin pasar por bodega ni por ruta (p. ej. lo entregó FedEx) no queda pendiente de desembarcar.
    const toUnload = gs.filter((g) => g.unAt || disp.has(g.id) || !FINAL_WITHOUT_ROUTE.has(g.status));
    const dispatched = gs.filter((g) => disp.has(g.id));
    // Por sacar a ruta: lo desembarcado que no terminó sin ruta, más lo que salió aunque no se desembarcara en el sistema.
    const dispatchTotal = gs.filter((g) => disp.has(g.id) || (g.unAt && !FINAL_WITHOUT_ROUTE.has(g.status))).length;
    const closed = dispatched.filter((g) => { const d = disp.get(g.id)!; return d.closed >= d.n; });
    const withDev = gs.filter((g) => devs.has(g.id));
    const dexPending = gs.filter((g) => !devs.has(g.id) && isDexStatus(g.status));
    return {
      unloading: prog(unloaded.map((g) => ({ at: g.unAt, by: g.unBy })), toUnload.length),
      dispatch: prog(dispatched.map((g) => ({ at: disp.get(g.id)!.last, by: disp.get(g.id)!.lastBy })), dispatchTotal),
      closure: prog(closed.map((g) => ({ at: disp.get(g.id)!.closedAt, by: disp.get(g.id)!.closedBy })), dispatched.length),
      devolutions: prog(withDev.map((g) => ({ at: devs.get(g.id)!.at, by: devs.get(g.id)!.by })), withDev.length + dexPending.length),
    };
  }

  private async guidesOf(kind: Kind, headIds: string[]): Promise<Guide[]> {
    const k = K[kind];
    const out: Guide[] = [];
    for (const part of chunk(headIds)) {
      const exc = kind === 'f2' ? 'g.exceptionCode' : 'NULL';
      const dhl = kind === 'f2' ? 'NULL' : 'g.dhlUniqueId';
      const rows: any[] = await this.db.query(
        `SELECT g.id, g.${k.headCol} headId, g.trackingNumber, ${dhl} dhlUniqueId, LOWER(g.status) status, g.commitDateTime, ${exc} exceptionCode, TRIM(h.consNumber) consNumber,
                u.createdAt unAt, u.createdById unBy
         FROM ${k.guides} g JOIN ${k.head} h ON h.id = g.${k.headCol} LEFT JOIN unloading u ON u.id = g.unloadingId
         WHERE g.${k.headCol} IN (${ph(part.length)}) AND g.active = 1`,
        part,
      );
      for (const r of rows) out.push({ ...r, unAt: toDate(r.unAt), commitDateTime: toDate(r.commitDateTime) });
    }
    return out;
  }

  private async dispatchAgg(kind: Kind, guideIds: string[]): Promise<Map<string, DispatchAgg>> {
    const fk = K[kind].fk;
    const out = new Map<string, DispatchAgg>();
    for (const part of chunk(guideIds)) {
      if (!part.length) continue;
      const rows: any[] = await this.db.query(
        `SELECT ph.${fk} id, MIN(ph.addedAt) first, MAX(ph.addedAt) last, COUNT(DISTINCT ph.dispatchId) n, COUNT(DISTINCT rc.package_dispatch_id) closed, MAX(rc.createdAt) closedAt,
                SUBSTRING_INDEX(MAX(CONCAT(ph.addedAt, '|', IFNULL(pd.createdById, ''))), '|', -1) lastBy,
                SUBSTRING_INDEX(MAX(CONCAT(IFNULL(rc.createdAt, ''), '|', IFNULL(rc.createdById, ''))), '|', -1) closedBy
         FROM package_dispatch_history ph JOIN package_dispatch pd ON pd.id = ph.dispatchId AND pd.active = 1
         LEFT JOIN route_closure rc ON rc.package_dispatch_id = ph.dispatchId
         WHERE ph.${fk} IN (${ph(part.length)}) GROUP BY ph.${fk}`,
        part,
      );
      for (const r of rows) {
        out.set(r.id, { first: new Date(r.first), last: new Date(r.last), lastBy: r.lastBy || null, n: Number(r.n), closed: Number(r.closed), closedAt: toDate(r.closedAt), closedBy: r.closedBy || null });
      }
    }
    return out;
  }

  /** Devoluciones vigentes (sin deshacer) por registro; las viejas sin registro se ligan por guía + sucursal. */
  private async devolutionAgg(kind: Kind, guides: { id: string; trackingNumber: string }[], subsidiaryId: string): Promise<Map<string, DevAgg>> {
    const fk = K[kind].fk;
    const out = new Map<string, DevAgg>();
    const byTn = new Map(guides.map((g) => [g.trackingNumber, g.id]));
    for (const part of chunk(guides)) {
      if (!part.length) continue;
      const rows: any[] = await this.db.query(
        `SELECT d.${fk} gid, d.trackingNumber, d.createdAt, d.createdById FROM devolution d
         WHERE d.undoneAt IS NULL AND (d.${fk} IN (${ph(part.length)}) OR (d.shipmentId IS NULL AND d.chargeShipmentId IS NULL AND d.subsidiaryId = ? AND d.trackingNumber IN (${ph(part.length)})))`,
        [...part.map((g) => g.id), subsidiaryId, ...part.map((g) => g.trackingNumber)],
      );
      for (const r of rows) {
        const id = r.gid ?? byTn.get(r.trackingNumber);
        if (!id) continue;
        const at = new Date(r.createdAt);
        const prev = out.get(id);
        if (!prev || at > prev.at) out.set(id, { at, by: r.createdById ?? null });
      }
    }
    return out;
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean) as string[])];
    if (!uniq.length) return new Map();
    const rows: any[] = await this.db.query(`SELECT id, TRIM(CONCAT(IFNULL(name, ''), ' ', IFNULL(lastName, ''))) name FROM \`user\` WHERE id IN (${ph(uniq.length)})`, uniq);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async subsidiaryFacts(subsidiaryId: string, day: string): Promise<SubsidiaryDayFacts> {
    const [from, to] = dayRange(day);
    const inv: any[] = await this.db.query(
      `SELECT i.type, MIN(i.createdAt) at, SUBSTRING_INDEX(MIN(CONCAT(i.createdAt, '|', TRIM(CONCAT(IFNULL(u.name, ''), ' ', IFNULL(u.lastName, ''))))), '|', -1) byName
       FROM inventory i LEFT JOIN \`user\` u ON u.id = i.createdById
       WHERE i.subsidiaryId = ? AND i.inventoryDate >= ? AND i.inventoryDate < ? GROUP BY i.type`,
      [subsidiaryId, from, to],
    );
    const invOf = (t: string) => inv.find((r) => r.type === t);
    const dispatches: any[] = await this.db.query(
      `SELECT pd.id, MAX(rc.createdAt) closedAt FROM package_dispatch pd LEFT JOIN route_closure rc ON rc.package_dispatch_id = pd.id
       WHERE pd.subsidiaryId = ? AND pd.active = 1 AND (pd.routeDate = ? OR (pd.routeDate IS NULL AND pd.createdAt >= ? AND pd.createdAt < ?))
       GROUP BY pd.id`,
      [subsidiaryId, day, from, to],
    );
    const closedAts = dispatches.map((d) => toDate(d.closedAt)).filter(Boolean) as Date[];

    let dexTotal = 0;
    let dexWithDevolution = 0;
    let lastDevolutionAt: Date | null = null;
    const ids = dispatches.map((d) => d.id);
    for (const kind of ['master', 'f2'] as Kind[]) {
      if (!ids.length) break;
      const k = K[kind];
      const gs: any[] = await this.db.query(
        `SELECT DISTINCT g.id, g.trackingNumber, LOWER(g.status) status FROM package_dispatch_history h JOIN ${k.guides} g ON g.id = h.${k.fk}
         WHERE h.dispatchId IN (${ph(ids.length)}) AND g.active = 1`,
        ids,
      );
      const devs = await this.devolutionAgg(kind, gs, subsidiaryId);
      for (const g of gs) {
        const dev = devs.get(g.id);
        if (dev) {
          dexTotal++;
          dexWithDevolution++;
          if (!lastDevolutionAt || dev.at > lastDevolutionAt) lastDevolutionAt = dev.at;
        } else if (isDexStatus(g.status)) dexTotal++;
      }
    }
    return {
      day,
      inventoryInitialAt: toDate(invOf('initial')?.at), inventoryInitialBy: invOf('initial')?.byName || null,
      inventoryFinalAt: toDate(invOf('final')?.at), inventoryFinalBy: invOf('final')?.byName || null,
      dispatchesTotal: dispatches.length, dispatchesClosed: closedAts.length,
      lastClosureAt: closedAts.length ? new Date(Math.max(...closedAts.map((d) => d.getTime()))) : null,
      dexTotal, dexWithDevolution, lastDevolutionAt,
    };
  }

  /** Estado LD de cada guía (regla única; misma variante que el reporte de bodega). */
  private async ldStates(kind: Kind, guides: Guide[], today: string): Promise<Map<string, LdState>> {
    const fk = K[kind].fk;
    const due = new Map<string, string>();
    for (const g of guides) if (g.commitDateTime) due.set(g.id, herDay(g.commitDateTime));
    const moved = new Map<string, Set<string>>();
    const dex = new Map<string, Set<string>>();
    const ids = guides.filter((g) => (due.get(g.id) ?? '9') <= today).map((g) => g.id);
    for (const part of chunk(ids)) {
      if (!part.length) continue;
      const rows: any[] = await this.db.query(`SELECT ${fk} id, exceptionCode, timestamp ts FROM shipment_status WHERE ${fk} IN (${ph(part.length)})`, part);
      for (const r of rows) {
        const d = herDay(r.ts);
        if (!moved.has(r.id)) moved.set(r.id, new Set());
        moved.get(r.id)!.add(d);
        if (['03', '05', '07', '08', '17', '42'].includes(String(r.exceptionCode ?? '').trim())) {
          if (!dex.has(r.id)) dex.set(r.id, new Set());
          dex.get(r.id)!.add(d);
        }
      }
    }
    const out = new Map<string, LdState>();
    for (const g of guides) {
      const cd = due.get(g.id) ?? null;
      out.set(g.id, classifyLd({
        status: g.status, due: !cd || cd > today ? null : cd === today ? 'today' : 'past',
        dexOnCommitDay: !!cd && !!dex.get(g.id)?.has(cd), movedOnCommitDay: !!cd && !!moved.get(g.id)?.has(cd),
        requireNoMovement: true, excludeClosed: false,
      }));
    }
    return out;
  }

  private bucketOf(g: Guide, unloaded: boolean): string {
    if (DELIVERED.has(g.status)) return 'Entregado';
    if (g.status === 'devuelto_a_fedex' || g.status === 'retorno_abandono_fedex') return 'Devuelto a FedEx';
    if (g.status === 'en_ruta' || g.status === 'en_transito') return 'En ruta';
    if (isDexStatus(g.status)) return `DEX ${dexCodeOf(g.status, g.exceptionCode)}`;
    return unloaded ? 'En bodega' : 'Sin desembarcar';
  }

  async packageDetail(refType: 'consolidated' | 'charge', refId: string, today: string): Promise<{ summary: PackageSummary; guides: { trackingNumber: string; status: string; bucket: string; ld: LdState }[] }> {
    const kind: Kind = refType === 'charge' ? 'f2' : 'master';
    const guides = await this.guidesOf(kind, [refId]);
    if (kind === 'master') await this.fillExceptionCodes(guides);
    const ld = await this.ldStates(kind, guides, today);
    const inInv = await this.inTodayInventory(kind, guides.map((g) => g.id), today);
    const rows = guides.map((g) => ({ g, unloaded: !!g.unAt, ld: ld.get(g.id) ?? ('active' as LdState) }));
    return {
      summary: summarizePackages(rows.map((r) => ({ status: r.g.status, exceptionCode: r.g.exceptionCode, unloaded: r.unloaded, inTodayInventory: inInv.has(r.g.id), ld: r.ld }))),
      guides: rows.map((r) => ({ trackingNumber: r.g.trackingNumber, status: r.g.status, bucket: this.bucketOf(r.g, r.unloaded), ld: r.ld })),
    };
  }

  /** shipment no guarda exceptionCode: se toma el del último estatus que lo trae. */
  private async fillExceptionCodes(guides: Guide[]): Promise<void> {
    const ids = guides.filter((g) => isDexStatus(g.status)).map((g) => g.id);
    for (const part of chunk(ids)) {
      if (!part.length) continue;
      const rows: any[] = await this.db.query(
        `SELECT shipmentId id, SUBSTRING_INDEX(MAX(CONCAT(timestamp, '|', exceptionCode)), '|', -1) code
         FROM shipment_status WHERE shipmentId IN (${ph(part.length)}) AND exceptionCode IS NOT NULL AND exceptionCode <> '' GROUP BY shipmentId`,
        part,
      );
      const m = new Map(rows.map((r) => [r.id, r.code]));
      for (const g of guides) if (m.has(g.id)) g.exceptionCode = m.get(g.id);
    }
  }

  private async inTodayInventory(kind: Kind, ids: string[], today: string): Promise<Set<string>> {
    const k = K[kind];
    const [from, to] = dayRange(today);
    const out = new Set<string>();
    for (const part of chunk(ids)) {
      if (!part.length) continue;
      const rows: any[] = await this.db.query(
        `SELECT DISTINCT j.${k.fk} id FROM ${k.inv} j JOIN inventory i ON i.id = j.inventoryId
         WHERE j.${k.fk} IN (${ph(part.length)}) AND i.inventoryDate >= ? AND i.inventoryDate < ?`,
        [...part, from, to],
      );
      for (const r of rows) out.add(r.id);
    }
    return out;
  }

  /** Guías de la sucursal que vencen en `day` y son LD o posible LD (para el día y para la foto de las 20:30). */
  async ldCandidates(subsidiaryId: string, day: string): Promise<{ trackingNumber: string; pieceKey: string; consNumber: string; status: string; bucket: string; shipmentId: string | null; chargeShipmentId: string | null }[]> {
    const [from, to] = dayRange(day);
    const out: { trackingNumber: string; pieceKey: string; consNumber: string; status: string; bucket: string; shipmentId: string | null; chargeShipmentId: string | null }[] = [];
    for (const kind of ['master', 'f2'] as Kind[]) {
      const k = K[kind];
      const exc = kind === 'f2' ? 'g.exceptionCode' : 'NULL';
      const dhl = kind === 'f2' ? 'NULL' : 'g.dhlUniqueId';
      const rows: any[] = await this.db.query(
        `SELECT g.id, g.${k.headCol} headId, g.trackingNumber, ${dhl} dhlUniqueId, LOWER(g.status) status, g.commitDateTime, ${exc} exceptionCode, TRIM(IFNULL(g.consNumber, '')) consNumber,
                u.createdAt unAt, u.createdById unBy
         FROM ${k.guides} g LEFT JOIN unloading u ON u.id = g.unloadingId
         WHERE g.subsidiaryId = ? AND g.active = 1 AND g.commitDateTime >= ? AND g.commitDateTime < ?`,
        [subsidiaryId, from, to],
      );
      const guides: Guide[] = rows.map((r) => ({ ...r, unAt: toDate(r.unAt), commitDateTime: toDate(r.commitDateTime) }));
      const ld = await this.ldStates(kind, guides, day);
      for (const g of guides) {
        const st = ld.get(g.id);
        if (st !== 'possible_ld' && st !== 'ld') continue;
        out.push({ trackingNumber: g.trackingNumber, pieceKey: pieceKeyOf(g), consNumber: g.consNumber, status: g.status, bucket: this.bucketOf(g, !!g.unAt), shipmentId: kind === 'master' ? g.id : null, chargeShipmentId: kind === 'f2' ? g.id : null });
      }
    }
    return out;
  }
}
