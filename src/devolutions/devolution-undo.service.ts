import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Devolution } from 'src/entities/devolution.entity';
import { ChargeShipment, Income, Shipment } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction, AuditModule, AuditResult, AuditSeverity } from 'src/common/enums/audit.enum';

export interface DevolutionUndoRecord {
  kind: 'shipment' | 'charge';
  id: string;
  consNumber: string | null;
  /** Estatus que tiene hoy. */
  currentStatus: string;
  /** Estatus al que regresa. */
  toStatus: string;
  /** Solo se regresa si sigue "devuelto a FedEx" (si ya cambió, se deja como está). */
  willRevert: boolean;
}

export interface DevolutionUndoImpact {
  devolutionId: string;
  trackingNumber: string;
  label: string;
  subsidiaryId: string | null;
  targetKey: string;
  records: DevolutionUndoRecord[];
  incomes: { id: string; cost: number }[];
}

const NOTE_PREFIX = 'Devolución registrada';

/**
 * Deshacer una devolución (con autorización). Regresa los registros que la devolución marcó como
 * "devuelto a FedEx" al estatus que tenían, quita del historial el evento de devolución que puso
 * esta devolución, reactiva el ingreso "entregado" que se anuló (y borra su reversa) y deja la
 * devolución marcada como deshecha. Todo en una transacción y con bitácora.
 *
 * Devoluciones anteriores al 17-oct-2026 no guardaban qué cambiaron: se reconstruye desde el
 * historial (registros de la guía con el evento "Devolución registrada" de esa fecha).
 */
@Injectable()
export class DevolutionUndoService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  static targetKey(devolutionId: string) {
    return `undo_devolution:${devolutionId}`;
  }

  async impact(devolutionId: string, manager: EntityManager = this.dataSource.manager): Promise<DevolutionUndoImpact> {
    const dev = await manager.findOne(Devolution, { where: { id: devolutionId }, relations: ['subsidiary'] });
    if (!dev) throw new NotFoundException('Devolución no encontrada.');
    if (dev.undoneAt) throw new BadRequestException('Esta devolución ya se deshizo.');

    const planned = dev.appliedChanges?.records?.length
      ? dev.appliedChanges.records
      : await this.legacyRecords(manager, dev);

    const records: DevolutionUndoRecord[] = [];
    for (const p of planned) {
      const table = p.kind === 'shipment' ? 'shipment' : 'charge_shipment';
      const [row] = await manager.query(
        `SELECT t.status, COALESCE(c.consNumber, t.consNumber) AS consNumber
           FROM ${table} t LEFT JOIN consolidated c ON c.id = t.consolidatedId WHERE t.id = ?`,
        [p.id],
      );
      if (!row) continue;
      records.push({
        kind: p.kind,
        id: p.id,
        consNumber: row.consNumber ?? null,
        currentStatus: row.status,
        toStatus: p.fromStatus,
        willRevert: row.status === ShipmentStatusType.DEVUELTO_A_FEDEX,
      });
    }

    const incomeIds = dev.appliedChanges?.annulledIncomeIds ?? [];
    const incomes = incomeIds.length
      ? (await manager.find(Income, { where: { id: In(incomeIds) }, select: ['id', 'cost', 'active'] }))
          .filter((i) => !i.active)
          .map((i) => ({ id: i.id, cost: Number(i.cost) }))
      : [];

    return {
      devolutionId: dev.id,
      trackingNumber: dev.trackingNumber,
      label: `devolución de la guía ${dev.trackingNumber}`,
      subsidiaryId: dev.subsidiary?.id ?? null,
      targetKey: DevolutionUndoService.targetKey(dev.id),
      records,
      incomes,
    };
  }

  /** Antes del 17-oct: registros de la guía con el evento de devolución de esa fecha. */
  private async legacyRecords(manager: EntityManager, dev: Devolution) {
    const rows: any[] = await manager.query(
      `SELECT 'shipment' AS kind, s.id FROM shipment s
         JOIN shipment_status ss ON ss.shipmentId = s.id
        WHERE s.trackingNumber = ? AND ss.status = 'devuelto_a_fedex' AND ss.timestamp = ? AND ss.notes LIKE ?
       UNION
       SELECT 'charge' AS kind, c.id FROM charge_shipment c
         JOIN shipment_status ss ON ss.chargeShipmentId = c.id
        WHERE c.trackingNumber = ? AND ss.status = 'devuelto_a_fedex' AND ss.timestamp = ? AND ss.notes LIKE ?`,
      [dev.trackingNumber, dev.date, `${NOTE_PREFIX}%`, dev.trackingNumber, dev.date, `${NOTE_PREFIX}%`],
    );
    const out: { kind: 'shipment' | 'charge'; id: string; fromStatus: string }[] = [];
    for (const r of rows) {
      // Estatus anterior = último evento del historial que no sea la devolución.
      const col = r.kind === 'shipment' ? 'shipmentId' : 'chargeShipmentId';
      const [prev] = await manager.query(
        `SELECT status FROM shipment_status
          WHERE ${col} = ? AND NOT (status = 'devuelto_a_fedex' AND timestamp = ? AND notes LIKE ?)
          ORDER BY timestamp DESC, createdAt DESC LIMIT 1`,
        [r.id, dev.date, `${NOTE_PREFIX}%`],
      );
      out.push({ kind: r.kind, id: r.id, fromStatus: prev?.status ?? ShipmentStatusType.PENDIENTE });
    }
    return out;
  }

  async execute(
    devolutionId: string,
    actor: { userId: string; name?: string; role?: string },
    reason: string,
  ): Promise<DevolutionUndoImpact> {
    return this.dataSource.transaction(async (m) => {
      const impact = await this.impact(devolutionId, m);
      const dev = await m.findOneOrFail(Devolution, { where: { id: devolutionId } });

      for (const r of impact.records.filter((x) => x.willRevert)) {
        const col = r.kind === 'shipment' ? 'shipmentId' : 'chargeShipmentId';
        await m.query(
          `DELETE FROM shipment_status
            WHERE ${col} = ? AND status = 'devuelto_a_fedex' AND timestamp = ? AND notes LIKE ?`,
          [r.id, dev.date, `${NOTE_PREFIX}%`],
        );
        if (r.kind === 'shipment') await m.update(Shipment, r.id, { status: r.toStatus as ShipmentStatusType });
        else await m.update(ChargeShipment, r.id, { status: r.toStatus as ShipmentStatusType });
      }

      for (const inc of impact.incomes) {
        await m.update(Income, inc.id, { active: true, annulledAt: null, annulledById: null } as any);
        await m.query(`DELETE FROM income WHERE reversalOfIncomeId = ?`, [inc.id]);
      }

      await m.update(Devolution, devolutionId, {
        undoneAt: new Date(),
        undoneById: actor.userId,
        undoReason: reason?.trim() || null,
      });

      try {
        this.audit.log({
          userId: actor.userId,
          userName: actor.name,
          role: actor.role,
          module: AuditModule.DEVOLUCIONES,
          action: AuditAction.UPDATE,
          result: AuditResult.SUCCESS,
          severity: AuditSeverity.WARNING,
          entityName: 'devolution',
          entityId: devolutionId,
          subsidiaryId: impact.subsidiaryId ?? undefined,
          description: `Se deshizo la ${impact.label}`.slice(0, 500),
          beforeState: impact,
          metadata: { reason },
        });
      } catch {
        /* la bitácora nunca bloquea */
      }
      return impact;
    });
  }
}
