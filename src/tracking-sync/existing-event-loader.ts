import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { buildShadowKey } from './event-key.util';
import { ExistingState, TrackableKind } from './tracking-sync.types';
import { computeEffectiveLastOpTime, DispatchAnchor } from './route-op-time.util';

/**
 * Lee (READ-ONLY) el historial existente de shipment_status y construye el set de
 * shadowKeys ya conocidos, para que el Reconciler detecte eventos nuevos en shadow
 * sin necesitar la columna eventKey (que no existe hasta el cutover).
 * Soporta normales (shipmentId) y F2 (chargeShipmentId) vía `kind`.
 */
@Injectable()
export class ExistingEventLoader {
  constructor(
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepo: Repository<ShipmentStatus>,
    // Opcional para no romper tests que solo ejercen `load()`; en runtime siempre se inyecta.
    @Optional()
    @InjectRepository(PackageDispatchHistory)
    private readonly dispatchHistoryRepo?: Repository<PackageDispatchHistory>,
  ) {}

  async load(id: string, kind: TrackableKind = 'shipment'): Promise<Set<string>> {
    return (await this.loadFull(id, kind)).keys;
  }

  /** Como `load` pero además calcula el estado existente (lastOpTime, 08) en una sola query. */
  async loadFull(id: string, kind: TrackableKind = 'shipment'): Promise<{ keys: Set<string>; existing: ExistingState }> {
    const where = kind === 'charge' ? { chargeShipment: { id } } : { shipment: { id } };
    const rows = await this.shipmentStatusRepo.find({
      where,
      select: ['timestamp', 'exceptionCode', 'status'],
    });
    const keys = new Set<string>();
    let count08 = 0;
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      keys.add(buildShadowKey(t, r.exceptionCode ?? null, r.status));
      if ((r.exceptionCode ?? '').trim() === '08') count08++;
    }
    // lastOpTime EFECTIVO: re-ancla el EN_RUTA de rutas RETROACTIVAS a su día operativo
    // (routeDate) para que el Time Shield no lo blinde contra el estatus real de FedEx del día
    // (caso 383295956902). El shadow lo usa para que la paridad refleje el motor mejorado.
    const dispatches = await this.loadDispatchAnchors(id, kind);
    const lastOpTime = computeEffectiveLastOpTime(rows, dispatches);
    return { keys, existing: { lastOpTime, count08 } };
  }

  private async loadDispatchAnchors(id: string, kind: TrackableKind): Promise<DispatchAnchor[]> {
    if (!this.dispatchHistoryRepo) return [];
    const history = await this.dispatchHistoryRepo.find({
      where: kind === 'charge' ? { chargeShipment: { id } } : { shipment: { id } },
      relations: ['dispatch'],
    });
    return history
      .map((h) => h.dispatch)
      .filter((d) => !!d && !!d.routeDate && !!d.createdAt)
      .map((d) => ({ routeDate: d.routeDate, createdAt: d.createdAt }));
  }
}
