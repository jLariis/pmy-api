import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { buildShadowKey } from './event-key.util';

/**
 * Lee (READ-ONLY) el historial existente de shipment_status y construye el set de
 * shadowKeys ya conocidos, para que el Reconciler detecte eventos nuevos en shadow
 * sin necesitar la columna eventKey (que no existe hasta el cutover).
 */
@Injectable()
export class ExistingEventLoader {
  constructor(
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepo: Repository<ShipmentStatus>,
  ) {}

  async load(shipmentId: string): Promise<Set<string>> {
    const rows = await this.shipmentStatusRepo.find({
      where: { shipment: { id: shipmentId } },
      select: ['timestamp', 'exceptionCode', 'status'],
    });
    const set = new Set<string>();
    for (const r of rows) {
      set.add(buildShadowKey(new Date(r.timestamp).getTime(), r.exceptionCode ?? null, r.status));
    }
    return set;
  }
}
