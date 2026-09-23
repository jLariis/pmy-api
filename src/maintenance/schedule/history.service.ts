import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { Vehicle } from 'src/entities/vehicle.entity';

export interface HistoryQuery {
  from?: string;
  to?: string;
  vehicleId?: string;
}

/** Historial de mantenimientos (órdenes completadas) por sucursal, con resumen por unidad. */
@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(PurchaseOrder) private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
  ) {}

  async bySubsidiary(subsidiaryId: string, q: HistoryQuery = {}) {
    const qb = this.orders
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.vehicle', 'vehicle')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .leftJoinAndSelect('po.items', 'item')
      .where('po.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere("po.status = 'completada'")
      .orderBy('po.completedAt', 'DESC');
    if (q.from) qb.andWhere('po.completedAt >= :from', { from: new Date(`${q.from.slice(0, 10)}T07:00:00.000Z`) });
    if (q.to) qb.andWhere('po.completedAt < DATE_ADD(:to, INTERVAL 1 DAY)', { to: new Date(`${q.to.slice(0, 10)}T07:00:00.000Z`) });
    if (q.vehicleId) qb.andWhere('po.vehicleId = :vehicleId', { vehicleId: q.vehicleId });
    const list = await qb.getMany();

    const rows = list.map((po) => ({
      poId: po.id,
      requestId: po.requestId,
      folio: po.folio,
      completedAt: po.completedAt,
      completedKms: po.completedKms,
      vehicle: po.vehicle,
      supplierName: po.supplier?.name ?? '',
      services: (po.items ?? []).filter((i) => i.approved).map((i) => i.description),
      amount: Number(po.finalAmount ?? po.total),
    }));

    const byVehicleMap = new Map<string, { vehicle: Vehicle; count: number; total: number }>();
    for (const r of rows) {
      const e = byVehicleMap.get(r.vehicle.id) ?? { vehicle: r.vehicle, count: 0, total: 0 };
      e.count++;
      e.total = Math.round((e.total + r.amount) * 100) / 100;
      byVehicleMap.set(r.vehicle.id, e);
    }
    const byVehicle = [...byVehicleMap.values()]
      .map((e) => ({ ...e, lastMaintenanceDate: e.vehicle.lastMaintenanceDate ?? null, lastMaintenanceKms: e.vehicle.lastMaintenanceKms ?? null }))
      .sort((a, b) => b.total - a.total);

    // Registros previos al módulo: unidades con último mantenimiento capturado pero sin órdenes completadas.
    const withOrders = new Set(byVehicleMap.keys());
    const legacyVehicles = q.vehicleId
      ? []
      : await this.vehicles
          .createQueryBuilder('v')
          .where('v.subsidiaryId = :subsidiaryId', { subsidiaryId })
          .andWhere('v.lastMaintenanceDate IS NOT NULL')
          .orderBy('v.lastMaintenanceDate', 'DESC')
          .getMany();
    const legacy = legacyVehicles
      .filter((v) => !withOrders.has(v.id))
      .map((v) => ({ vehicle: v, lastMaintenanceDate: v.lastMaintenanceDate ?? null }));

    return { rows, byVehicle, legacy };
  }
}
