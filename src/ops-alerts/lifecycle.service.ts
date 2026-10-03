import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { Lifecycle, StepProgress } from './ops-alerts.util';

type Agg = { total: number; unloaded: number; unFirst: Date | null; unLast: Date | null; dispatched: number; dFirst: Date | null; dLast: Date | null; closed: number; cFirst: Date | null; cLast: Date | null };

const toDate = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const empty = (): Agg => ({ total: 0, unloaded: 0, unFirst: null, unLast: null, dispatched: 0, dFirst: null, dLast: null, closed: 0, cFirst: null, cLast: null });

/**
 * Recorrido de los consolidados anunciados por correo, calculado desde las guías:
 * desembarcadas (unloadingId), en ruta (package_dispatch_history) y con ruta cerrada
 * (route_closure de su salida). Master/aéreo → consolidated → shipment; F2 → charge → charge_shipment.
 */
@Injectable()
export class LifecycleService {
  constructor(private readonly ds: DataSource) {}

  private async aggregate(kind: 'master' | 'f2', consNumbers: string[]): Promise<Map<string, Agg>> {
    const out = new Map<string, Agg>();
    if (!consNumbers.length) return out;
    const ph = consNumbers.map(() => '?').join(',');
    const f2 = kind === 'f2';
    const head = f2 ? 'charge h' : 'consolidated h';
    const guides = f2 ? 'charge_shipment g ON g.chargeId = h.id' : 'shipment g ON g.consolidatedId = h.id';
    const active = f2 ? '' : 'AND h.active = 1';
    const histCol = f2 ? 'chargeShipmentId' : 'shipmentId';

    const base: any[] = await this.ds.query(
      `SELECT TRIM(h.consNumber) AS cons, COUNT(DISTINCT g.id) AS total, COUNT(DISTINCT CASE WHEN g.unloadingId IS NOT NULL THEN g.id END) AS unloaded,
              MIN(u.createdAt) AS unFirst, MAX(u.createdAt) AS unLast
       FROM ${head} JOIN ${guides} LEFT JOIN unloading u ON u.id = g.unloadingId
       WHERE TRIM(h.consNumber) IN (${ph}) ${active} GROUP BY TRIM(h.consNumber)`,
      consNumbers,
    );
    const disp: any[] = await this.ds.query(
      `SELECT TRIM(h.consNumber) AS cons, COUNT(DISTINCT g.id) AS n, MIN(pd.createdAt) AS first, MAX(pd.createdAt) AS last
       FROM ${head} JOIN ${guides} JOIN package_dispatch_history ph ON ph.${histCol} = g.id JOIN package_dispatch pd ON pd.id = ph.dispatchId
       WHERE TRIM(h.consNumber) IN (${ph}) ${active} GROUP BY TRIM(h.consNumber)`,
      consNumbers,
    );
    const clos: any[] = await this.ds.query(
      `SELECT TRIM(h.consNumber) AS cons, COUNT(DISTINCT g.id) AS n, MIN(rc.createdAt) AS first, MAX(rc.createdAt) AS last
       FROM ${head} JOIN ${guides} JOIN package_dispatch_history ph ON ph.${histCol} = g.id JOIN route_closure rc ON rc.package_dispatch_id = ph.dispatchId
       WHERE TRIM(h.consNumber) IN (${ph}) ${active} GROUP BY TRIM(h.consNumber)`,
      consNumbers,
    );
    for (const r of base) {
      out.set(String(r.cons).trim(), { ...empty(), total: Number(r.total), unloaded: Number(r.unloaded), unFirst: toDate(r.unFirst), unLast: toDate(r.unLast) });
    }
    for (const r of disp) {
      const a = out.get(String(r.cons).trim()) ?? empty();
      Object.assign(a, { dispatched: Number(r.n), dFirst: toDate(r.first), dLast: toDate(r.last) });
      out.set(String(r.cons).trim(), a);
    }
    for (const r of clos) {
      const a = out.get(String(r.cons).trim()) ?? empty();
      Object.assign(a, { closed: Number(r.n), cFirst: toDate(r.first), cLast: toDate(r.last) });
      out.set(String(r.cons).trim(), a);
    }
    return out;
  }

  /** Recorrido por id de inbox_consolidation. */
  async forConsolidations(list: InboxConsolidation[]): Promise<Map<string, Lifecycle>> {
    const masters = [...new Set(list.filter((c) => c.kind !== 'f2').map((c) => c.consNumber))];
    const f2s = [...new Set(list.filter((c) => c.kind === 'f2').map((c) => c.consNumber))];
    const [m, f] = await Promise.all([this.aggregate('master', masters), this.aggregate('f2', f2s)]);
    const out = new Map<string, Lifecycle>();
    for (const c of list) {
      const a = (c.kind === 'f2' ? f : m).get(c.consNumber) ?? empty();
      const p = (done: number, first: Date | null, last: Date | null): StepProgress => ({ done, total: a.total, first, last });
      out.set(c.id, {
        receivedAt: c.receivedAt,
        uploadedAt: c.uploadedAt ?? (a.total > 0 ? c.receivedAt : null),
        unloading: p(a.unloaded, a.unFirst, a.unLast),
        dispatch: p(a.dispatched, a.dFirst, a.dLast),
        closure: p(a.closed, a.cFirst, a.cLast),
      });
    }
    return out;
  }
}
