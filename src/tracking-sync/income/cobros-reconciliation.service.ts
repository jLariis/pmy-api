import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CobrosReconciliationReport } from 'src/entities/cobros-reconciliation-report.entity';

/** Fila rica de descuadre (una por GUÍA, no por fila) para la pantalla. */
export interface CobrosReconRow {
  trackingNumber: string;
  consNumber: string | null;
  subsidiary: string | null;
  recipientName: string | null;
  status: string | null;
  date: string | null; // entrega/compromiso (missing) o fecha del ingreso (orphan)
  cost: number | null;
}

export interface CobrosReconcileReport {
  windowDays: number;
  deliveredShipments: number;    // GUÍAS entregadas distintas (dedup por trackingNumber)
  missingIncome: CobrosReconRow[]; // entregados SIN ingreso 'entregado' (cobro perdido)
  orphanIncome: CobrosReconRow[];  // ingreso 'entregado' cuyo envío NO está entregado (cobro a revisar)
  missingCount: number;
  orphanCount: number;
}

export interface CobrosReportHistoryRow {
  id: string;
  runAt: Date;
  windowDays: number;
  deliveredShipments: number;
  missingCount: number;
  orphanCount: number;
}

/**
 * Reconciliación de cobros a NIVEL BD (independiente del motor/cutover, read-only):
 *  - missingIncome: envíos ENTREGADOS en la ventana sin un Income 'entregado' → cobro perdido.
 *  - orphanIncome : Income 'entregado' cuyo envío ya NO está ENTREGADO → cobro a revisar.
 * Sirve como guardia permanente de "cobros correctos", venga el ingreso del legacy o del motor.
 */
@Injectable()
export class CobrosReconciliationService {
  private readonly logger = new Logger(CobrosReconciliationService.name);
  private static readonly SAMPLE_CAP = 100;

  constructor(private readonly dataSource: DataSource) {}

  async reconcile(windowDays = 14): Promise<CobrosReconcileReport> {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    // Dedup por GUÍA: cuenta guías distintas, no filas (evita falsos por reciclaje en varios consolidados).
    const deliveredRow = await this.dataSource.query(
      `SELECT COUNT(DISTINCT trackingNumber) AS c FROM shipment
        WHERE LOWER(status) = 'entregado' AND createdAt >= ?`,
      [since],
    );
    const deliveredShipments = Number(deliveredRow?.[0]?.c ?? 0);

    // Entregados SIN ingreso 'entregado' → una fila por guía, con datos del paquete/consolidado.
    const missingRows = await this.dataSource.query(
      `SELECT s.trackingNumber AS trackingNumber,
              MAX(s.consNumber) AS consNumber, MAX(sub.name) AS subsidiary,
              MAX(s.recipientName) AS recipientName, 'entregado' AS status,
              MAX(s.commitDateTime) AS date, MAX(sub.fedexCostPackage) AS cost
         FROM shipment s
         LEFT JOIN income i
           ON i.trackingNumber = s.trackingNumber AND LOWER(i.incomeType) = 'entregado'
         LEFT JOIN subsidiary sub ON sub.id = s.subsidiaryId
        WHERE LOWER(s.status) = 'entregado' AND s.createdAt >= ? AND i.id IS NULL
        GROUP BY s.trackingNumber
        LIMIT ?`,
      [since, CobrosReconciliationService.SAMPLE_CAP + 1],
    );

    // Ingreso 'entregado' cuyo envío ya NO está entregado → una fila por guía.
    const orphanRows = await this.dataSource.query(
      `SELECT i.trackingNumber AS trackingNumber,
              MAX(s.consNumber) AS consNumber, MAX(sub.name) AS subsidiary,
              MAX(s.recipientName) AS recipientName, MAX(s.status) AS status,
              MAX(i.date) AS date, MAX(i.cost) AS cost
         FROM income i
         JOIN shipment s ON s.id = i.shipmentId
         LEFT JOIN subsidiary sub ON sub.id = s.subsidiaryId
        WHERE LOWER(i.incomeType) = 'entregado' AND i.date >= ? AND LOWER(s.status) <> 'entregado'
        GROUP BY i.trackingNumber
        LIMIT ?`,
      [since, CobrosReconciliationService.SAMPLE_CAP + 1],
    );

    const toRow = (r: any): CobrosReconRow => ({
      trackingNumber: String(r.trackingNumber),
      consNumber: r.consNumber ?? null,
      subsidiary: r.subsidiary ?? null,
      recipientName: r.recipientName ?? null,
      status: r.status ?? null,
      date: r.date ? new Date(r.date).toISOString() : null,
      cost: r.cost != null ? Number(r.cost) : null,
    });
    const missingIncome = (missingRows || []).map(toRow);
    const orphanIncome = (orphanRows || []).map(toRow);

    return {
      windowDays,
      deliveredShipments,
      missingIncome: missingIncome.slice(0, CobrosReconciliationService.SAMPLE_CAP),
      orphanIncome: orphanIncome.slice(0, CobrosReconciliationService.SAMPLE_CAP),
      missingCount: missingIncome.length,
      orphanCount: orphanIncome.length,
    };
  }

  /** Corre la reconciliación y persiste un snapshot (para la tendencia). Devuelve el reporte. */
  async reconcileAndPersist(windowDays = 14): Promise<CobrosReconcileReport> {
    const report = await this.reconcile(windowDays);
    await this.dataSource.getRepository(CobrosReconciliationReport).save(
      this.dataSource.getRepository(CobrosReconciliationReport).create({
        runAt: new Date(),
        windowDays: report.windowDays,
        deliveredShipments: report.deliveredShipments,
        missingCount: report.missingCount,
        orphanCount: report.orphanCount,
        missingSample: JSON.stringify(report.missingIncome),
        orphanSample: JSON.stringify(report.orphanIncome),
      }),
    );
    return report;
  }

  /** Últimas corridas persistidas (tendencia), más recientes primero. */
  async history(limit = 30): Promise<CobrosReportHistoryRow[]> {
    const rows = await this.dataSource.getRepository(CobrosReconciliationReport).find({
      order: { runAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
      select: ['id', 'runAt', 'windowDays', 'deliveredShipments', 'missingCount', 'orphanCount'],
    });
    return rows as CobrosReportHistoryRow[];
  }
}
