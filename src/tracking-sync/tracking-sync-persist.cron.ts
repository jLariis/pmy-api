import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TrackingCompareService } from './tracking-compare.service';
import { prioritizeTrackables } from './cadence/prioritize.util';
import { isCutoverEnabled, isSubsidiaryInCutover } from './cutover.config';
import { TrackableItem } from './tracking-sync.types';

/**
 * Cron de CUTOVER (F3/F4). Solo actúa cuando `TRACKING_SYNC_CUTOVER=true`; entonces el motor
 * ESCRIBE estatus (applyMany → persistentSink) y, para sucursales en cutover, genera cobros.
 * Corre en punto (:00), reemplazando al legacy (que se salta cuando el cutover está on).
 * DEFAULT OFF: no hace nada hasta encender la bandera.
 */
@Injectable()
export class TrackingSyncPersistCron {
  private readonly logger = new Logger(TrackingSyncPersistCron.name);
  private running = false;
  // Tope opcional por corrida (respeta cuota FedEx); 0/undefined = sin tope.
  private readonly cap = Number(process.env.TRACKING_SYNC_CUTOVER_CAP || 0) || undefined;

  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly compare: TrackingCompareService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handlePersistCron(): Promise<void> {
    if (!isCutoverEnabled()) return; // apagado: el legacy manda
    if (this.running) {
      this.logger.warn('⏭️ [cutover] corrida anterior en curso; se omite.');
      return;
    }
    this.running = true;
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
      // Rollout por sucursal: si hay allowlist, solo esas.
      items = items.filter((it) => isSubsidiaryInCutover((it.entity as any)?.subsidiary?.id));
      if (!items.length) {
        this.logger.log('📪 [cutover] no hay guías en cutover para procesar.');
        return;
      }

      const ordered = prioritizeTrackables(items, this.cap ? { cap: this.cap } : undefined);
      const ids = ordered.map((it) => it.entity.id);
      const actor = { userName: 'tracking-sync-cutover', role: 'system' };

      this.logger.log(`⚙️ [cutover] persistiendo ${ids.length} guías (motor por eventos)...`);
      const outcomes = await this.compare.applyMany(ids, actor);
      const applied = outcomes.filter((o) => o.applied).length;
      this.logger.log(`✅ [cutover] ${applied}/${ids.length} con cambios en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err: any) {
      this.logger.error(`❌ [cutover] error: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }
}
