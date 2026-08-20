import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { AuditService } from 'src/audit/audit.service';
import { AuditModule as AuditModuleEnum, AuditAction, AuditResult, AuditSeverity } from 'src/common/enums/audit.enum';
import { buildShadowKey } from '../event-key.util';
import { SyncContext } from '../tracking-sync.types';
import { ApplyOutcome } from '../compare.types';

export interface ApplyActor {
  userId?: string;
  userName?: string;
  role?: string;
}

/**
 * Sink de ESCRITURA (status-only). Inserta los eventos faltantes en shipment_status y
 * actualiza shipment.status en una transacción. Idempotente por shadowKey. NO genera
 * ingresos. Registra en auditoría. Disparado manualmente por superadmin.
 */
@Injectable()
export class PersistentSyncSink {
  private readonly logger = new Logger(PersistentSyncSink.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async applyPlan(ctx: SyncContext, actor: ApplyActor): Promise<ApplyOutcome> {
    const shipment = ctx.shipment;
    const isCharge = ctx.kind === 'charge';
    const fromStatus = shipment.status;
    const toStatus = ctx.proposedStatus;

    try {
      let inserted = 0;
      let statusChanged = false;

      await this.dataSource.transaction(async (m) => {
        // Recalcula las shadowKeys conocidas DENTRO de la TX para una escritura idempotente segura.
        // El FK del historial cambia según el tipo: shipmentId (normal) vs chargeShipmentId (F2).
        const rows = await m.find(ShipmentStatus, {
          where: isCharge ? { chargeShipment: { id: shipment.id } } : { shipment: { id: shipment.id } },
          select: ['timestamp', 'exceptionCode', 'status'],
        });
        const known = new Set(
          rows.map((r) => buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status)),
        );

        const toInsert = ctx.reconcile.newEvents.filter(
          (e) => !ctx.vetoedEventKeys.has(e.eventKey) && !known.has(e.shadowKey),
        );

        for (const e of toInsert) {
          const row = m.create(ShipmentStatus, {
            status: e.status,
            exceptionCode: e.exceptionCode ?? '',
            timestamp: e.occurredAt,
            notes: e.description ?? 'FedEx (panel)',
            ...(isCharge ? { chargeShipment: shipment as any } : { shipment: shipment as any }),
          });
          await m.save(ShipmentStatus, row);
          inserted++;
        }

        if (toStatus && toStatus !== fromStatus) {
          shipment.status = toStatus;
          await m.save(isCharge ? ChargeShipment : Shipment, shipment as any);
          statusChanged = true;
        }
      });

      const applied = inserted > 0 || statusChanged;
      if (applied) {
        this.auditService.log({
          userId: actor.userId,
          userName: actor.userName,
          role: actor.role,
          module: AuditModuleEnum.ENVIOS,
          action: AuditAction.STATUS_CHANGE,
          result: AuditResult.SUCCESS,
          severity: AuditSeverity.INFO,
          entityName: 'shipment',
          entityId: shipment.id,
          description: `Corrección manual FedEx (panel): ${fromStatus} → ${toStatus ?? fromStatus}, ${inserted} eventos`,
          beforeState: { status: fromStatus },
          afterState: { status: toStatus ?? fromStatus },
          changes: { status: { from: fromStatus, to: toStatus ?? fromStatus } },
          metadata: { trackingNumber: shipment.trackingNumber, insertedEvents: inserted, kind: ctx.kind },
        });
      }

      const latest = ctx.normalized?.latest ?? null;
      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        applied,
        fromStatus,
        toStatus: toStatus ?? fromStatus,
        insertedEvents: inserted,
        kind: ctx.kind,
        exceptionCode: latest?.exceptionCode ?? null,
        eventAt: latest?.occurredAt ? new Date(latest.occurredAt).toISOString() : null,
      };
    } catch (err: any) {
      this.logger.error(`applyPlan ${shipment.trackingNumber}: ${err?.message}`);
      return {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        applied: false,
        fromStatus,
        toStatus: null,
        insertedEvents: 0,
        error: err?.message ?? 'Error aplicando',
      };
    }
  }
}
