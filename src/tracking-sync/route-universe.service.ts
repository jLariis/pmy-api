import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { TrackableItem } from './tracking-sync.types';

const TERMINAL_LC = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());

/**
 * Universo "rutas del día": guías (envíos + cargas) de las salidas a ruta con `routeDate = hoy`
 * (Hermosillo), excluyendo estatus terminal. Lo comparten el sync persistente (cutover) y el
 * shadow, para revisar solo lo activo y no "todo lo pendiente". Read-only.
 */
@Injectable()
export class RouteUniverseService {
  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
  ) {}

  /** Hora actual en Hermosillo (0–23). */
  hermosilloHour(): number {
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Hermosillo', hour: '2-digit', hour12: false }).format(new Date()));
    return h % 24;
  }

  async todayRouteItems(): Promise<TrackableItem[]> {
    const day = toHermosilloDateString(new Date());
    const ships = await this.shipmentRepo
      .createQueryBuilder('s')
      .innerJoin('s.packageDispatch', 'pd')
      .leftJoin('s.subsidiary', 'sub')
      .where('DATE(pd.routeDate) = :day', { day })
      .andWhere('LOWER(s.status) NOT IN (:...term)', { term: TERMINAL_LC })
      .select(['s.id AS id', 's.status AS status', 'sub.id AS subid'])
      .getRawMany();
    const charges = await this.chargeRepo
      .createQueryBuilder('c')
      .innerJoin('c.packageDispatch', 'pd')
      .leftJoin('c.subsidiary', 'sub')
      .where('DATE(pd.routeDate) = :day', { day })
      .andWhere('LOWER(c.status) NOT IN (:...term)', { term: TERMINAL_LC })
      .select(['c.id AS id', 'c.status AS status', 'sub.id AS subid'])
      .getRawMany();
    return [
      ...ships.map((r: any) => ({ kind: 'shipment' as const, entity: { id: r.id, status: r.status, subsidiary: { id: r.subid } } as any })),
      ...charges.map((r: any) => ({ kind: 'charge' as const, entity: { id: r.id, status: r.status, subsidiary: { id: r.subid } } as any })),
    ];
  }
}
