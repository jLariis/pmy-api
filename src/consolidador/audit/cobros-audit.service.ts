import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  auditShipmentCobros,
  AuditEvent,
  AuditIncome,
  CobroFinding,
  CobroRule,
} from '../logic/cobros-audit.util';

/** Fila de descuadre para la pantalla (una por guía + regla + dirección). */
export interface CobrosAuditRow extends CobroFinding {
  currentStatus: string | null;
  cost: number | null; // costo esperado del cobro (fedexCostPackage de la sucursal)
}

export interface CobrosAuditRuleBucket {
  rule: CobroRule;
  missing: CobrosAuditRow[];
  missingCount: number;
  missingAmount: number;
  extra: CobrosAuditRow[];
  extraCount: number;
  extraAmount: number;
}

export interface CobrosAuditReport {
  subsidiaryId: string;
  subsidiaryName: string | null;
  from: string;
  to: string;
  evaluated: number; // guías con actividad en la semana
  rules: CobrosAuditRuleBucket[];
  totals: { missingCount: number; extraCount: number; missingAmount: number; extraAmount: number };
}

/**
 * Auditoría de cobros por SUCURSAL + SEMANA sobre guías FedEx de ENVÍO (read-only).
 * Junta los eventos FedEx relevantes y los ingresos de la semana por guía y delega la
 * clasificación al util puro (`auditShipmentCobros`), que aplica las reglas reales
 * (entregado / 07 / DEX08 por 3 días distintos). Independiente del motor (legacy o cutover).
 */
@Injectable()
export class CobrosAuditService {
  private readonly logger = new Logger(CobrosAuditService.name);
  private static readonly ROW_CAP = 300;

  constructor(private readonly dataSource: DataSource) {}

  async audit(subsidiaryId: string, from: Date, to: Date): Promise<CobrosAuditReport> {
    const subRow = await this.dataSource.query(
      `SELECT name, fedexCostPackage FROM subsidiary WHERE id = ? LIMIT 1`,
      [subsidiaryId],
    );
    const subsidiaryName: string | null = subRow?.[0]?.name ?? null;
    const cost: number | null = subRow?.[0]?.fedexCostPackage != null ? Number(subRow[0].fedexCostPackage) : null;

    // Eventos FedEx relevantes de la semana (entregado / rechazado / 07 / 08).
    const eventRows = await this.dataSource.query(
      `SELECT s.trackingNumber AS trackingNumber, s.status AS currentStatus,
              ss.status AS evStatus, ss.exceptionCode AS exceptionCode, ss.timestamp AS ts,
              (SELECT 1 FROM charge_shipment cs WHERE cs.trackingNumber = s.trackingNumber LIMIT 1) AS isF2
         FROM shipment s
         JOIN shipment_status ss ON ss.shipmentId = s.id
        WHERE s.subsidiaryId = ?
          AND LOWER(s.shipmentType) = 'fedex'
          AND ss.timestamp BETWEEN ? AND ?
          AND (LOWER(ss.status) IN ('entregado','rechazado') OR ss.exceptionCode IN ('07','08'))`,
      [subsidiaryId, from, to],
    );

    // Ingresos activos de envío de la semana (entregado / no_entregado).
    const incomeRows = await this.dataSource.query(
      `SELECT s.trackingNumber AS trackingNumber, s.status AS currentStatus,
              i.incomeType AS incomeType, i.nonDeliveryStatus AS nonDeliveryStatus, i.date AS date,
              (SELECT 1 FROM charge_shipment cs WHERE cs.trackingNumber = s.trackingNumber LIMIT 1) AS isF2
         FROM income i
         JOIN shipment s ON s.id = i.shipmentId
        WHERE s.subsidiaryId = ?
          AND i.active = 1
          AND i.sourceType = 'shipment'
          AND LOWER(i.incomeType) IN ('entregado','no_entregado')
          AND i.date BETWEEN ? AND ?`,
      [subsidiaryId, from, to],
    );

    // Agrupa por guía.
    type Bag = { currentStatus: string | null; isF2: boolean; events: AuditEvent[]; incomes: AuditIncome[] };
    const byTn = new Map<string, Bag>();
    const bag = (tn: string, currentStatus: string | null, isF2: boolean): Bag => {
      let b = byTn.get(tn);
      if (!b) { b = { currentStatus, isF2, events: [], incomes: [] }; byTn.set(tn, b); }
      if (isF2) b.isF2 = true;
      if (currentStatus != null) b.currentStatus = currentStatus; // el estatus vivo del shipment
      return b;
    };

    for (const r of eventRows) {
      const b = bag(String(r.trackingNumber), r.currentStatus ?? null, Number(r.isF2) === 1);
      b.events.push({ status: r.evStatus ?? null, exceptionCode: r.exceptionCode ?? null, timestamp: new Date(r.ts) });
    }
    for (const r of incomeRows) {
      const b = bag(String(r.trackingNumber), r.currentStatus ?? null, Number(r.isF2) === 1);
      b.incomes.push({ incomeType: r.incomeType ?? null, nonDeliveryStatus: r.nonDeliveryStatus ?? null, date: new Date(r.date) });
    }

    // Clasifica por guía y arma las filas.
    const rules: CobroRule[] = ['entregado', 'no_entregado'];
    const buckets = new Map<CobroRule, CobrosAuditRuleBucket>(
      rules.map((rule) => [rule, { rule, missing: [], missingCount: 0, missingAmount: 0, extra: [], extraCount: 0, extraAmount: 0 }]),
    );

    for (const [tn, b] of byTn) {
      const findings = auditShipmentCobros({
        trackingNumber: tn, isF2: b.isF2, currentStatus: b.currentStatus, events: b.events, incomes: b.incomes,
      });
      for (const f of findings) {
        const bk = buckets.get(f.rule)!;
        const row: CobrosAuditRow = { ...f, currentStatus: b.currentStatus, cost };
        const amount = (cost ?? 0) * (f.discrepancy === 'extra' ? f.count : 1);
        if (f.discrepancy === 'missing') {
          bk.missingCount += 1; bk.missingAmount += amount;
          if (bk.missing.length < CobrosAuditService.ROW_CAP) bk.missing.push(row);
        } else {
          bk.extraCount += f.count; bk.extraAmount += amount;
          if (bk.extra.length < CobrosAuditService.ROW_CAP) bk.extra.push(row);
        }
      }
    }

    const ruleList = [...buckets.values()];
    const totals = ruleList.reduce(
      (acc, r) => ({
        missingCount: acc.missingCount + r.missingCount,
        extraCount: acc.extraCount + r.extraCount,
        missingAmount: acc.missingAmount + r.missingAmount,
        extraAmount: acc.extraAmount + r.extraAmount,
      }),
      { missingCount: 0, extraCount: 0, missingAmount: 0, extraAmount: 0 },
    );

    return {
      subsidiaryId,
      subsidiaryName,
      from: from.toISOString(),
      to: to.toISOString(),
      evaluated: byTn.size,
      rules: ruleList,
      totals,
    };
  }
}
