import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TrackingCompareService } from './tracking-compare.service';
import { prioritizeTrackables } from './cadence/prioritize.util';
import { isCutoverEnabled, isSubsidiaryInCutover } from './cutover.config';
import { TrackableItem } from './tracking-sync.types';

const START_HOUR = Number(process.env.FEDEX_SYNC_START_HOUR || 7);
const END_HOUR = Number(process.env.FEDEX_SYNC_END_HOUR || 22);
const TERMINAL_LC = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());

/**
 * Cron de CUTOVER (F3/F4). Solo actúa cuando `TRACKING_SYNC_CUTOVER=true`.
 *  - Sync frecuente (cada 15 min, 07:00–22:00 Hermosillo): SOLO las guías de las RUTAS DEL DÍA
 *    (routeDate = hoy) que NO estén en estatus terminal. Barato y casi en vivo.
 *  - Barrida diaria (05:00 Hermosillo): toda la cola pendiente, como respaldo para resoluciones
 *    fuera de ruta (ocurre, DL tardío, OD de terceros).
 * DEFAULT OFF: no hace nada hasta encender la bandera. El cron legacy se apaga en paralelo.
 */
@Injectable()
export class TrackingSyncPersistCron {
  private readonly logger = new Logger(TrackingSyncPersistCron.name);
  private runningRoute = false;
  private runningSweep = false;
  private readonly cap = Number(process.env.TRACKING_SYNC_CUTOVER_CAP || 0) || undefined;

  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
    private readonly shipmentsService: ShipmentsService,
    private readonly compare: TrackingCompareService,
  ) {}

  /** Hora actual en Hermosillo (0–23). */
  private hermosilloHour(): number {
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Hermosillo', hour: '2-digit', hour12: false }).format(new Date()));
    return h % 24;
  }

  /** Ids (shipment + charge) de las rutas de HOY, excluyendo estatus terminal. */
  private async todayRouteIds(): Promise<{ kind: 'shipment' | 'charge'; entity: any }[]> {
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
      ...ships.map((r: any) => ({ kind: 'shipment' as const, entity: { id: r.id, status: r.status, subsidiary: { id: r.subid } } })),
      ...charges.map((r: any) => ({ kind: 'charge' as const, entity: { id: r.id, status: r.status, subsidiary: { id: r.subid } } })),
    ];
  }

  @Cron('0 */15 * * * *') // cada 15 minutos
  async handleRouteSync(): Promise<void> {
    if (!isCutoverEnabled()) return;
    const hour = this.hermosilloHour();
    if (hour < START_HOUR || hour >= END_HOUR) return; // fuera de horario hábil
    if (this.runningRoute) { this.logger.warn('⏭️ [rutas] corrida anterior en curso; se omite.'); return; }
    this.runningRoute = true;
    const t0 = Date.now();
    try {
      let items = await this.todayRouteIds();
      items = items.filter((it) => isSubsidiaryInCutover(it.entity?.subsidiary?.id));
      if (!items.length) { this.logger.log('📪 [rutas] sin guías de ruta (no-terminal) para sincronizar.'); return; }
      const ordered = prioritizeTrackables(items as TrackableItem[], this.cap ? { cap: this.cap } : undefined);
      const ids = ordered.map((it) => it.entity.id);
      const outcomes = await this.compare.applyMany(ids, { userName: 'fedex-sync-rutas', role: 'system' });
      const applied = outcomes.filter((o) => o.applied).length;
      this.logger.log(`✅ [rutas] ${applied}/${ids.length} con cambios en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err: any) {
      this.logger.error(`❌ [rutas] error: ${err?.message}`);
    } finally {
      this.runningRoute = false;
    }
  }

  @Cron('0 0 5 * * *', { timeZone: 'America/Hermosillo' }) // barrida diaria 05:00
  async handleDailySweep(): Promise<void> {
    if (!isCutoverEnabled()) return;
    if (this.runningSweep) { this.logger.warn('⏭️ [barrida] corrida anterior en curso; se omite.'); return; }
    this.runningSweep = true;
    const t0 = Date.now();
    try {
      const [shipments, charges] = await Promise.all([
        this.shipmentsService.getShipmentsToValidate(),
        this.shipmentsService.getSimpleChargeShipments(),
      ]);
      let items: TrackableItem[] = [
        ...shipments.map((entity) => ({ kind: 'shipment' as const, entity })),
        ...charges.map((entity) => ({ kind: 'charge' as const, entity })),
      ];
      items = items.filter((it) => isSubsidiaryInCutover((it.entity as any)?.subsidiary?.id));
      if (!items.length) { this.logger.log('📪 [barrida] sin guías pendientes.'); return; }
      const ids = prioritizeTrackables(items).map((it) => it.entity.id);
      const outcomes = await this.compare.applyMany(ids, { userName: 'fedex-sync-barrida', role: 'system' });
      const applied = outcomes.filter((o) => o.applied).length;
      this.logger.log(`✅ [barrida] ${applied}/${ids.length} con cambios en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err: any) {
      this.logger.error(`❌ [barrida] error: ${err?.message}`);
    } finally {
      this.runningSweep = false;
    }
  }
}
