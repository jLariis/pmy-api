import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface CobrosReconcileReport {
  windowDays: number;
  deliveredShipments: number;
  missingIncome: string[];   // entregados SIN ingreso 'entregado' (posible cobro perdido)
  orphanIncome: string[];    // ingreso 'entregado' cuyo envío NO está entregado (posible cobro falso)
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

    const deliveredRow = await this.dataSource.query(
      `SELECT COUNT(*) AS c FROM shipment
        WHERE LOWER(status) = 'entregado' AND createdAt >= ?`,
      [since],
    );
    const deliveredShipments = Number(deliveredRow?.[0]?.c ?? 0);

    const missingRows = await this.dataSource.query(
      `SELECT s.trackingNumber AS tn
         FROM shipment s
         LEFT JOIN income i
           ON i.trackingNumber = s.trackingNumber AND LOWER(i.incomeType) = 'entregado'
        WHERE LOWER(s.status) = 'entregado' AND s.createdAt >= ? AND i.id IS NULL
        LIMIT ?`,
      [since, CobrosReconciliationService.SAMPLE_CAP + 1],
    );

    const orphanRows = await this.dataSource.query(
      `SELECT i.trackingNumber AS tn
         FROM income i
         JOIN shipment s ON s.id = i.shipmentId
        WHERE LOWER(i.incomeType) = 'entregado' AND i.date >= ? AND LOWER(s.status) <> 'entregado'
        LIMIT ?`,
      [since, CobrosReconciliationService.SAMPLE_CAP + 1],
    );

    const missingIncome = (missingRows || []).map((r: any) => String(r.tn));
    const orphanIncome = (orphanRows || []).map((r: any) => String(r.tn));

    return {
      windowDays,
      deliveredShipments,
      missingIncome: missingIncome.slice(0, CobrosReconciliationService.SAMPLE_CAP),
      orphanIncome: orphanIncome.slice(0, CobrosReconciliationService.SAMPLE_CAP),
      missingCount: missingIncome.length,
      orphanCount: orphanIncome.length,
    };
  }
}
