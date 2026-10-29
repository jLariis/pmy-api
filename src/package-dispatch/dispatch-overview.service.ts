import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import {
  ClosureSource, StatusEvent, changedSinceClosure, closureBucket, displayCode, latestEvent,
  applyClosureListHint, reconstructAtClosure, resolveClosureState,
} from './dispatch-overview.util';

export interface DispatchOverviewPackage {
  key: string;
  shipmentId: string | null;
  chargeShipmentId: string | null;
  isCharge: boolean;
  trackingNumber: string;
  carrier: 'fedex' | 'dhl' | 'otro';
  shipmentType: string | null;
  recipientName: string | null;
  recipientAddress: string | null;
  recipientZip: string | null;
  recipientPhone: string | null;
  isHighValue: boolean;
  payment: { type: string; amount: number } | null;
  addedAt: string;
  current: { status: string; code: string | null };
  atClosure: { status: string; code: string | null; source: ClosureSource } | null;
  changedAfterClosure: boolean;
}

/**
 * "Ver salida": la salida con cada guía/carga que llevó, su estatus de hoy y el estatus con
 * que quedó al cerrar (arreglo del superadmin > foto del cierre > reconstrucción del historial).
 * Solo lectura.
 */
@Injectable()
export class DispatchOverviewService {
  constructor(private readonly dataSource: DataSource) {}

  async getOverview(dispatchId: string) {
    const dispatch = await this.dataSource.getRepository(PackageDispatch).findOne({
      where: { id: dispatchId },
      relations: ['subsidiary', 'drivers', 'routes', 'vehicle', 'createdBy'],
    });
    if (!dispatch) throw new NotFoundException('No se encontró la salida a ruta.');
    const q = (sql: string, params: any[] = []) => this.dataSource.query(sql, params);

    const rows: any[] = await q(
      `SELECT h.shipmentId, h.chargeShipmentId, MIN(h.addedAt) addedAt,
              MAX(h.closureStatus) fixStatus, MAX(h.closureExceptionCode) fixCode,
              COALESCE(s.trackingNumber, c.trackingNumber) trackingNumber,
              COALESCE(s.shipmentType, c.shipmentType) shipmentType,
              COALESCE(s.recipientName, c.recipientName) recipientName,
              COALESCE(s.recipientAddress, c.recipientAddress) recipientAddress,
              COALESCE(s.recipientZip, c.recipientZip) recipientZip,
              COALESCE(s.recipientPhone, c.recipientPhone) recipientPhone,
              COALESCE(s.isHighValue, c.isHighValue) isHighValue,
              COALESCE(s.status, c.status) status
         FROM package_dispatch_history h
         LEFT JOIN shipment s ON s.id = h.shipmentId
         LEFT JOIN charge_shipment c ON c.id = h.chargeShipmentId
        WHERE h.dispatchId = ? AND COALESCE(s.id, c.id) IS NOT NULL
        GROUP BY h.shipmentId, h.chargeShipmentId
        ORDER BY addedAt`,
      [dispatchId],
    );
    const shipmentIds = rows.filter((r) => r.shipmentId).map((r) => r.shipmentId);
    const chargeIds = rows.filter((r) => !r.shipmentId).map((r) => r.chargeShipmentId);
    const anyIn = (ids: string[]) => (ids.length ? ids : ['-']);

    const [closure] = await q(
      `SELECT rc.id, rc.createdAt, rc.closeDate, rc.actualKms, rc.collections, rc.closureGroupId,
              TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lastName, ''))) closedBy
         FROM route_closure rc LEFT JOIN user u ON u.id = rc.createdById
        WHERE rc.package_dispatch_id = ? ORDER BY rc.createdAt DESC LIMIT 1`,
      [dispatchId],
    );

    const [payments, events, snapshot, noVan, groupFolios, changes, closureLists] = await Promise.all([
      q(`SELECT shipmentId, chargeShipmentId, type, amount FROM payment
          WHERE shipmentId IN (?) OR chargeShipmentId IN (?)`, [anyIn(shipmentIds), anyIn(chargeIds)]),
      q(`SELECT shipmentId, chargeShipmentId, status, NULLIF(exceptionCode, '') exceptionCode, timestamp, createdAt
           FROM shipment_status WHERE shipmentId IN (?) OR chargeShipmentId IN (?)`, [anyIn(shipmentIds), anyIn(chargeIds)]),
      closure
        ? q('SELECT shipmentId, chargeShipmentId, status, exceptionCode FROM route_closure_package WHERE routeClosureId = ?', [closure.id])
        : Promise.resolve([]),
      q('SELECT trackingNumber FROM shipment_not_in_files WHERE dispatchId = ? ORDER BY createdAt', [dispatchId]),
      closure?.closureGroupId
        ? q(`SELECT pd.trackingNumber FROM route_closure rc JOIN package_dispatch pd ON pd.id = rc.package_dispatch_id
              WHERE rc.closureGroupId = ? ORDER BY pd.createdAt`, [closure.closureGroupId])
        : Promise.resolve([]),
      q('SELECT COUNT(*) n FROM package_dispatch_change WHERE dispatchId = ?', [dispatchId]),
      closure
        ? q(`SELECT shipment_id id, 'pod' list FROM route_closure_pod_packages WHERE route_closure_id = ?
             UNION ALL SELECT shipment_id, 'returned' FROM route_closure_returned_packages WHERE route_closure_id = ?`, [closure.id, closure.id])
        : Promise.resolve([]),
    ]);
    const listBy = new Map<string, 'pod' | 'returned'>(closureLists.map((r: any) => [`s:${r.id}`, r.list]));

    const keyOf = (r: { shipmentId?: string | null; chargeShipmentId?: string | null }) =>
      r.shipmentId ? `s:${r.shipmentId}` : `c:${r.chargeShipmentId}`;
    const group = <T>(list: T[], key: (x: T) => string) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
      return m;
    };
    const eventsBy = group<any>(events, keyOf);
    const paymentBy = new Map<string, any>(payments.map((p: any) => [keyOf(p), p]));
    const snapshotBy = new Map<string, any>(snapshot.map((p: any) => [keyOf(p), p]));

    const packages: DispatchOverviewPackage[] = rows.map((r) => {
      const key = keyOf(r);
      const evs: StatusEvent[] = eventsBy.get(key) ?? [];
      const now = { status: String(r.status), exceptionCode: latestEvent(evs)?.exceptionCode ?? null };
      const atClosure = closure
        ? resolveClosureState({
            fix: r.fixStatus ? { status: r.fixStatus, exceptionCode: r.fixCode } : null,
            snapshot: snapshotBy.get(key) ?? null,
            reconstructed: snapshotBy.size ? null : applyClosureListHint(reconstructAtClosure(evs, closure.createdAt), listBy.get(key) ?? null),
          })
        : null;
      const pay = paymentBy.get(key);
      const type = String(r.shipmentType ?? '').toLowerCase();
      return {
        key,
        shipmentId: r.shipmentId ?? null,
        chargeShipmentId: r.chargeShipmentId ?? null,
        isCharge: !r.shipmentId,
        trackingNumber: r.trackingNumber,
        carrier: type === 'dhl' ? 'dhl' : type === 'fedex' || !type ? 'fedex' : 'otro',
        shipmentType: r.shipmentType ?? null,
        recipientName: r.recipientName ?? null,
        recipientAddress: r.recipientAddress ?? null,
        recipientZip: r.recipientZip ?? null,
        recipientPhone: r.recipientPhone ?? null,
        isHighValue: !!Number(r.isHighValue),
        payment: pay ? { type: pay.type, amount: Number(pay.amount) } : null,
        addedAt: new Date(r.addedAt).toISOString(),
        current: { status: now.status, code: displayCode(now.status, now.exceptionCode) },
        atClosure: atClosure
          ? { status: atClosure.status, code: displayCode(atClosure.status, atClosure.exceptionCode), source: atClosure.source }
          : null,
        changedAfterClosure: changedSinceClosure(atClosure, now),
      };
    });

    const count = (bucket: string) => packages.filter((p) => p.atClosure && closureBucket(p.atClosure.status) === bucket).length;
    const collections = closure
      ? (typeof closure.collections === 'string' ? JSON.parse(closure.collections) : closure.collections) ?? []
      : [];

    return {
      id: dispatch.id,
      folio: dispatch.trackingNumber,
      status: dispatch.status,
      is315: !!dispatch.is315,
      sortMode: dispatch.sortMode ?? null,
      subsidiary: dispatch.subsidiary
        ? {
            id: dispatch.subsidiary.id,
            name: dispatch.subsidiary.name,
            sortDispatchByCarrier: !!dispatch.subsidiary.sortDispatchByCarrier,
            sortDispatchByPostalCode: !!dispatch.subsidiary.sortDispatchByPostalCode,
          }
        : null,
      drivers: (dispatch.drivers ?? []).map((d) => ({ id: d.id, name: d.name })),
      routes: (dispatch.routes ?? []).map((r) => ({ id: r.id, name: r.name })),
      vehicle: dispatch.vehicle ? { id: dispatch.vehicle.id, name: dispatch.vehicle.name } : null,
      routeDate: dispatch.routeDate ?? null,
      createdAt: dispatch.createdAt,
      createdBy: dispatch.createdBy ? [dispatch.createdBy.name, dispatch.createdBy.lastName].filter(Boolean).join(' ') : null,
      closure: closure
        ? {
            id: closure.id,
            closedAt: closure.createdAt,
            closedBy: closure.closedBy || null,
            actualKms: closure.actualKms || null,
            collections: collections.map((c: any) => (typeof c === 'string' ? c : c?.trackingNumber)).filter(Boolean),
            groupFolios: groupFolios.map((g: any) => g.trackingNumber),
            reconstructed: snapshotBy.size === 0,
          }
        : null,
      noVan: noVan.map((n: any) => n.trackingNumber),
      changesCount: Number(changes[0]?.n ?? 0),
      counts: {
        total: packages.length,
        entregados: count('entregado'),
        noEntregados: count('no_entregado'),
        otros: count('otro'),
        noVan: noVan.length,
        cambiaron: packages.filter((p) => p.changedAfterClosure).length,
      },
      packages,
    };
  }
}
