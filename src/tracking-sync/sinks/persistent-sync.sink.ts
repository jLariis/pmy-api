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
import { IncomeExecutor } from '../income/income-executor';
import { isSubsidiaryInCutover } from '../cutover.config';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

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
    private readonly incomeExecutor: IncomeExecutor,
  ) {}

  /** Materializa los efectos diferidos (solo en cutover): cobros, código 44 y metadata. */
  private async applyDeferredEffects(ctx: SyncContext, shipment: any, isCharge: boolean): Promise<void> {
    const effects = ctx.deferredEffects || [];

    // Cobros (solo envíos; los efectos income solo se emiten para shipments).
    if (!isCharge && effects.some((e) => e.type === 'income')) {
      await this.incomeExecutor.execute(effects, 'persist');
    }

    // Código 44: marca la fila del escaneo local (idempotente). Aplica a envíos y cargas.
    const fkCol = isCharge ? 'chargeShipmentId' : 'shipmentId';
    for (const e of effects.filter((x) => x.type === 'code44')) {
      const at = new Date(e.payload.at);
      await this.dataSource.query(
        `UPDATE shipment_status SET exceptionCode = '44', status = ?
           WHERE ${fkCol} = ? AND timestamp = ? AND (COALESCE(exceptionCode,'') <> '44' OR status <> ?)`,
        [ShipmentStatusType.EN_BODEGA, shipment.id, at, ShipmentStatusType.EN_BODEGA],
      );
    }

    // Metadata: fedexUniqueId / carrierCode / receivedByName / commitDateTime.
    const meta = effects.find((x) => x.type === 'metadata');
    if (meta) {
      const p = meta.payload;
      const patch: Record<string, any> = {};
      if (p.uniqueId && shipment.fedexUniqueId !== p.uniqueId) patch.fedexUniqueId = p.uniqueId;
      if (p.carrierCode && shipment.carrierCode !== p.carrierCode) patch.carrierCode = p.carrierCode;
      if (p.receivedByName && shipment.receivedByName !== p.receivedByName) patch.receivedByName = p.receivedByName;
      if (p.commitDateTime) patch.commitDateTime = new Date(p.commitDateTime);
      if (Object.keys(patch).length) {
        await this.dataSource.getRepository(isCharge ? ChargeShipment : Shipment).update({ id: shipment.id } as any, patch);
      }
    }
  }

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

      // CUTOVER (F3/F4) — efectos diferidos (cobros, código 44, metadata). Solo cuando la
      // sucursal está en cutover (default OFF = status-only, idéntico a hoy). Fuera de cutover
      // NO se ejecutan: el ingreso/código 44/metadata los sigue manejando el legacy.
      const subsidiaryId = (shipment as any)?.subsidiary?.id ?? (shipment as any)?.subsidiaryId ?? null;
      if (ctx.deferredEffects.length && isSubsidiaryInCutover(subsidiaryId)) {
        try { await this.applyDeferredEffects(ctx, shipment, isCharge); }
        catch (e: any) { this.logger.error(`applyPlan efectos ${shipment.trackingNumber}: ${e?.message}`); }
      }

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
