import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';

export interface ParityRunRow {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  total: number;
  ok: number;
  matchesLegacy: number;
  divergesLegacy: number;
  aborted: boolean;
  matchPct: number; // % de coincidencia (match / (match+diverge))
}

export interface ParityDivergenceRow {
  trackingNumber: string;
  kind: string | null;
  consNumber: string | null;
  subsidiary: string | null;
  recipientName: string | null;
  legacyCurrentStatus: string | null; // nuestro estatus actual
  proposedStatus: string | null;      // lo que propondría el motor
  wouldInsertEvents: number;
}

/**
 * Lee las observaciones del motor en SHADOW (nuevo vs legacy) para la vista de paridad.
 * Read-only: no toca estatus ni cobros. Muestra en qué guías el motor decide distinto.
 */
@Injectable()
export class ParityService {
  private static readonly CAP = 200;

  constructor(private readonly dataSource: DataSource) {}

  /** Últimas corridas shadow con su resumen de coincidencia. */
  async recentRuns(limit = 20): Promise<ParityRunRow[]> {
    const runs = await this.dataSource.getRepository(TrackingSyncRun).find({
      where: { mode: 'shadow' } as any,
      order: { startedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return runs.map((r: any) => {
      const denom = (r.matchesLegacy ?? 0) + (r.divergesLegacy ?? 0);
      return {
        id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null,
        total: r.total ?? 0, ok: r.ok ?? 0,
        matchesLegacy: r.matchesLegacy ?? 0, divergesLegacy: r.divergesLegacy ?? 0,
        aborted: !!r.aborted,
        matchPct: denom > 0 ? Math.round(((r.matchesLegacy ?? 0) / denom) * 100) : 100,
      };
    });
  }

  /** Guías donde el motor DIFIERE del legacy en una corrida (la más reciente si no se pasa runId). */
  async divergences(runId?: string, limit = ParityService.CAP): Promise<{ runId: string | null; rows: ParityDivergenceRow[] }> {
    let rid = runId;
    if (!rid) {
      const latest = await this.dataSource.getRepository(TrackingSyncRun).findOne({
        where: { mode: 'shadow' } as any, order: { startedAt: 'DESC' }, select: ['id'] as any,
      });
      rid = latest?.id ?? undefined;
    }
    if (!rid) return { runId: null, rows: [] };

    const raw = await this.dataSource.query(
      `SELECT o.trackingNumber AS trackingNumber, o.kind AS kind,
              o.legacyCurrentStatus AS legacyCurrentStatus, o.proposedStatus AS proposedStatus,
              o.wouldInsertEvents AS wouldInsertEvents,
              COALESCE(s.consNumber, c.consNumber) AS consNumber,
              COALESCE(subs.name, subc.name) AS subsidiary,
              COALESCE(s.recipientName, c.recipientName) AS recipientName
         FROM tracking_sync_observation o
         LEFT JOIN shipment s ON s.id = o.shipmentId
         LEFT JOIN subsidiary subs ON subs.id = s.subsidiaryId
         LEFT JOIN charge_shipment c ON c.id = o.shipmentId
         LEFT JOIN subsidiary subc ON subc.id = c.subsidiaryId
        WHERE o.runId = ? AND o.matchesLegacy = 0
        LIMIT ?`,
      [rid, Math.min(Math.max(limit, 1), ParityService.CAP)],
    );
    const rows: ParityDivergenceRow[] = (raw || []).map((r: any) => ({
      trackingNumber: String(r.trackingNumber),
      kind: r.kind ?? null,
      consNumber: r.consNumber ?? null,
      subsidiary: r.subsidiary ?? null,
      recipientName: r.recipientName ?? null,
      legacyCurrentStatus: r.legacyCurrentStatus ?? null,
      proposedStatus: r.proposedStatus ?? null,
      wouldInsertEvents: Number(r.wouldInsertEvents ?? 0),
    }));
    return { runId: rid, rows };
  }
}
