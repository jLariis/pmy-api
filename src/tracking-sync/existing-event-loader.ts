import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { buildShadowKey } from './event-key.util';
import { TrackableKind } from './tracking-sync.types';

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
    const where = kind === 'charge' ? { chargeShipment: { id } } : { shipment: { id } };
    const rows = await this.shipmentStatusRepo.find({
      where,
      select: ['timestamp', 'exceptionCode', 'status'],
    });
    const set = new Set<string>();
    for (const r of rows) {
      set.add(buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status));
    }
    return set;
  }
}
