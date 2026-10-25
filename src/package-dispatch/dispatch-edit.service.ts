import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ShipmentStatus } from 'src/entities';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { PackageDispatchChange } from 'src/entities/package-dispatch-change.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { PackageDispatchService } from './package-dispatch.service';
import { canEditDispatch, normalizeReason, statusBeforeDispatch } from './dispatch-edit.util';

export interface DispatchEditResult {
  dispatchId: string;
  trackingNumbers: string[];
}

/**
 * Edición de una salida a ruta abierta (permiso `operaciones.salidas.editar`):
 * agregar y quitar guías con motivo. Todo en una transacción; cada guía deja
 * registro en su historial de estatus, en `package_dispatch_change` (quién/qué/por qué)
 * y la petición queda en Auditoría (interceptor global + @Audit del controlador).
 */
@Injectable()
export class DispatchEditService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly dispatchService: PackageDispatchService,
  ) {}

  private async loadEditable(manager: EntityManager, dispatchId: string): Promise<PackageDispatch> {
    const dispatch = await manager.findOne(PackageDispatch, { where: { id: dispatchId }, relations: ['subsidiary'] });
    if (!dispatch) throw new NotFoundException('No se encontró la salida a ruta.');
    if (!canEditDispatch(dispatch.status)) {
      throw new BadRequestException('Esta salida ya está cerrada; solo se pueden editar salidas en ruta.');
    }
    return dispatch;
  }

  private reasonOrFail(reason: unknown): string {
    const r = normalizeReason(reason);
    if (!r) throw new BadRequestException('Escribe el motivo del cambio.');
    return r;
  }

  async addPackages(dispatchId: string, trackingNumbers: string[], reason: unknown, userId?: string): Promise<DispatchEditResult> {
    const why = this.reasonOrFail(reason);
    const codes = Array.from(new Set((trackingNumbers ?? []).map((t) => String(t ?? '').trim()).filter(Boolean)));
    if (codes.length === 0) throw new BadRequestException('Escanea o escribe al menos una guía para agregar.');

    const dispatch = await this.loadEditable(this.dataSource.manager, dispatchId);
    const subsidiaryId = dispatch.subsidiary?.id;

    // Misma validación que la salida normal (sucursal, devueltas a FedEx, existencia).
    const validated = await Promise.all(codes.map((c) => this.dispatchService.validateTrackingNumber(c, subsidiaryId)));
    const problems: string[] = [];
    const picks: { id: string; isCharge: boolean; trackingNumber: string; status: string | null }[] = [];
    for (let i = 0; i < codes.length; i++) {
      const v: any = validated[i];
      if (!v?.isValid || !v?.id) {
        problems.push(`${codes[i]}: ${v?.reason || 'no es válida para esta sucursal'}`);
        continue;
      }
      picks.push({ id: v.id, isCharge: !!v.isCharge, trackingNumber: v.trackingNumber ?? codes[i], status: v.status ?? null });
    }

    // Ya en esta salida o en otra salida abierta.
    const ids = picks.map((p) => p.id);
    if (ids.length) {
      const inRoute: { id: string; routeId: string | null; folio: string | null; dstatus: string | null }[] = await this.dataSource.query(
        `SELECT x.id, x.routeId, pd.trackingNumber AS folio, pd.status AS dstatus FROM (
           SELECT id, routeId FROM shipment WHERE id IN (?)
           UNION ALL SELECT id, routeId FROM charge_shipment WHERE id IN (?)
         ) x LEFT JOIN package_dispatch pd ON pd.id = x.routeId`,
        [ids, ids],
      );
      const byId = new Map(inRoute.map((r) => [r.id, r]));
      for (const p of [...picks]) {
        const r = byId.get(p.id);
        if (!r?.routeId) continue;
        if (r.routeId === dispatchId) problems.push(`${p.trackingNumber}: ya está en esta salida`);
        else if (p.status === ShipmentStatusType.EN_RUTA && canEditDispatch(r.dstatus)) {
          problems.push(`${p.trackingNumber}: ya va en otra salida abierta (${r.folio ?? 'sin folio'})`);
        }
      }
    }
    if (problems.length) throw new BadRequestException(`No se agregó nada. Revisa estas guías: ${problems.join(' · ')}`);

    await this.dataSource.transaction(async (m) => {
      await this.loadEditable(m, dispatchId); // pudo cerrarse mientras validábamos
      const now = new Date();
      for (const p of picks) {
        const relationKey = p.isCharge ? 'chargeShipment' : 'shipment';
        await m.query(`UPDATE \`${p.isCharge ? 'charge_shipment' : 'shipment'}\` SET status = ?, routeId = ? WHERE id = ?`, [ShipmentStatusType.EN_RUTA, dispatchId, p.id]);
        await m.save(ShipmentStatus, m.create(ShipmentStatus, {
          status: ShipmentStatusType.EN_RUTA,
          exceptionCode: '',
          notes: `Agregado a la salida ${dispatch.trackingNumber} (edición): ${why}`,
          timestamp: now,
          [relationKey]: { id: p.id },
        } as any));
        await m.save(PackageDispatchHistory, m.create(PackageDispatchHistory, {
          dispatch: { id: dispatchId },
          [relationKey]: { id: p.id },
        } as any));
        await m.save(PackageDispatchChange, m.create(PackageDispatchChange, {
          dispatchId, action: 'add', trackingNumber: p.trackingNumber,
          shipmentId: p.isCharge ? null : p.id, chargeShipmentId: p.isCharge ? p.id : null,
          previousStatus: p.status, newStatus: ShipmentStatusType.EN_RUTA, reason: why, createdById: userId ?? null,
        }));
      }
    });
    return { dispatchId, trackingNumbers: picks.map((p) => p.trackingNumber) };
  }

  /** `ids` = id de shipment o de charge_shipment de la salida. */
  async removePackages(dispatchId: string, ids: string[], reason: unknown, userId?: string): Promise<DispatchEditResult> {
    const why = this.reasonOrFail(reason);
    const unique = Array.from(new Set((ids ?? []).filter(Boolean)));
    if (unique.length === 0) throw new BadRequestException('Elige al menos un paquete para quitar.');

    const removed: string[] = [];
    await this.dataSource.transaction(async (m) => {
      const dispatch = await this.loadEditable(m, dispatchId);
      const rows = await m.find(PackageDispatchHistory, {
        where: [
          { dispatch: { id: dispatchId }, shipment: { id: In(unique) } },
          { dispatch: { id: dispatchId }, chargeShipment: { id: In(unique) } },
        ],
        relations: ['shipment', 'chargeShipment'],
      });
      const found = new Set(rows.map((r) => r.shipment?.id ?? r.chargeShipment?.id));
      const missing = unique.filter((id) => !found.has(id));
      if (missing.length) throw new BadRequestException('Algunos paquetes ya no están en esta salida. Actualiza la pantalla e intenta de nuevo.');

      const now = new Date();
      for (const row of rows) {
        const isCharge = !row.shipment && !!row.chargeShipment;
        const rec: any = row.shipment ?? row.chargeShipment;
        const relationKey = isCharge ? 'chargeShipment' : 'shipment';
        const history = await m.find(ShipmentStatus, { where: { [relationKey]: { id: rec.id } } as any, order: { timestamp: 'DESC' } });
        const back = statusBeforeDispatch(history, row.addedAt);

        // Solo se suelta la liga si apunta a ESTA salida (pudo moverse a otra).
        await m.query(`UPDATE \`${isCharge ? 'charge_shipment' : 'shipment'}\` SET status = ?, routeId = IF(routeId = ?, NULL, routeId) WHERE id = ?`, [back, dispatchId, rec.id]);
        await m.save(ShipmentStatus, m.create(ShipmentStatus, {
          status: back as any,
          exceptionCode: '',
          notes: `Quitado de la salida ${dispatch.trackingNumber} (edición): ${why}`,
          timestamp: now,
          [relationKey]: { id: rec.id },
        } as any));
        await m.delete(PackageDispatchHistory, { id: row.id });
        await m.save(PackageDispatchChange, m.create(PackageDispatchChange, {
          dispatchId, action: 'remove', trackingNumber: rec.trackingNumber,
          shipmentId: isCharge ? null : rec.id, chargeShipmentId: isCharge ? rec.id : null,
          previousStatus: rec.status ?? null, newStatus: back, reason: why, createdById: userId ?? null,
        }));
        removed.push(rec.trackingNumber);
      }
    });
    return { dispatchId, trackingNumbers: removed };
  }

  /** Historial de cambios de la salida, más reciente primero, con el nombre de quien lo hizo. */
  async listChanges(dispatchId: string) {
    const rows: any[] = await this.dataSource.query(
      `SELECT c.id, c.action, c.trackingNumber, c.previousStatus, c.newStatus, c.reason, c.createdAt,
              TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lastName, ''))) AS userName, u.email AS userEmail
         FROM package_dispatch_change c LEFT JOIN \`user\` u ON u.id = c.createdById
        WHERE c.dispatchId = ? ORDER BY c.createdAt DESC`,
      [dispatchId],
    );
    return rows.map((r) => ({ ...r, userName: r.userName || r.userEmail || 'Usuario desconocido' }));
  }
}
