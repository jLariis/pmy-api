import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { TrackableItem } from './tracking-sync.types';

const TERMINAL_LC = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());
const FEDEX_TYPE = ShipmentType.FEDEX.toLowerCase();

/**
 * Universo "rutas del día": guías (envíos + cargas) de las salidas a ruta con `routeDate = hoy`
 * (Hermosillo), excluyendo estatus terminal. Lo comparten el sync persistente (cutover) y el
 * shadow, para revisar solo lo activo y no "todo lo pendiente". Read-only.
 *
 * SOLO FedEx (`shipmentType = 'fedex'`): DHL se rastrea aparte con su API nativa
 * (`getDhlToPollNative` → cron horario). FedEx y DHL nunca se mezclan en un mismo universo,
 * porque a FedEx solo se le consultan guías FedEx (una guía DHL provoca 422).
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
    // Incluye la REFERENCIA de rastreo (trackingNumber/fedexUniqueId/carrierCode): el shadow la usa
    // para consultar a FedEx y para agrupar por guía. Sin ella todo colapsa a una sola clave y FedEx
    // recibe trackingNumber undefined → 422. El cutover persistente solo usa el id, pero no estorba.
    const ships = await this.shipmentRepo
      .createQueryBuilder('s')
      .innerJoin('s.packageDispatch', 'pd')
      .leftJoin('s.subsidiary', 'sub')
      .where('DATE(pd.routeDate) = :day', { day })
      .andWhere('LOWER(s.shipmentType) = :fedex', { fedex: FEDEX_TYPE }) // solo FedEx: DHL se rastrea con su API nativa
      .andWhere('LOWER(s.status) NOT IN (:...term)', { term: TERMINAL_LC })
      .select(['s.id AS id', 's.status AS status', 'sub.id AS subid', 's.trackingNumber AS trackingnumber', 's.fedexUniqueId AS fedexuniqueid', 's.carrierCode AS carriercode'])
      .getRawMany();
    const charges = await this.chargeRepo
      .createQueryBuilder('c')
      .innerJoin('c.packageDispatch', 'pd')
      .leftJoin('c.subsidiary', 'sub')
      .where('DATE(pd.routeDate) = :day', { day })
      .andWhere('LOWER(c.shipmentType) = :fedex', { fedex: FEDEX_TYPE }) // cargas F2 son siempre FedEx; nunca DHL
      .andWhere('LOWER(c.status) NOT IN (:...term)', { term: TERMINAL_LC })
      .select(['c.id AS id', 'c.status AS status', 'sub.id AS subid', 'c.trackingNumber AS trackingnumber', 'c.fedexUniqueId AS fedexuniqueid', 'c.carrierCode AS carriercode'])
      .getRawMany();
    return [
      ...ships.map((r: any) => ({ kind: 'shipment' as const, entity: { id: r.id, status: r.status, subsidiary: { id: r.subid }, trackingNumber: r.trackingnumber, fedexUniqueId: r.fedexuniqueid, carrierCode: r.carriercode } as any })),
      ...charges.map((r: any) => ({ kind: 'charge' as const, entity: { id: r.id, status: r.status, subsidiary: { id: r.subid }, trackingNumber: r.trackingnumber, fedexUniqueId: r.fedexuniqueid, carrierCode: r.carriercode } as any })),
    ];
  }
}
