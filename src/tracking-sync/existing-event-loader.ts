import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { buildShadowKey } from './event-key.util';
import { ExistingState, TrackableKind } from './tracking-sync.types';

const OPERATIONAL = new Set<string>([
  String(ShipmentStatusType.PENDIENTE),
  String(ShipmentStatusType.EN_BODEGA),
  String(ShipmentStatusType.EN_RUTA),
]);

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
    let lastOpTime = 0;
    let count08 = 0;
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      keys.add(buildShadowKey(t, r.exceptionCode ?? null, r.status));
      if (OPERATIONAL.has(String(r.status))) lastOpTime = Math.max(lastOpTime, t);
      if ((r.exceptionCode ?? '').trim() === '08') count08++;
    }
    return { keys, existing: { lastOpTime, count08 } };
  }
}
