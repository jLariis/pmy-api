import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { TrackableItem } from './tracking-sync.types';

/**
 * Corre en SHADOW cada hora al minuto :15 (desfasado del cron legacy en :00 para no
 * competir por cuota de FedEx). Solo lee el universo de guías; no cambia estatus real.
 */
@Injectable()
export class TrackingSyncCron {
  private readonly logger = new Logger(TrackingSyncCron.name);
  private isRunning = false;

  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly orchestrator: TrackingSyncOrchestrator,
  ) {}

  @Cron('0 15 * * * *', { timeZone: 'America/Hermosillo' })
  async handleShadowSync() {
    if (this.isRunning) {
      this.logger.warn('⏭️ [shadow] corrida anterior en curso; se omite este disparo.');
      return;
    }
    this.isRunning = true;
    try {
      const [shipments, charges] = await Promise.all([
        this.shipmentsService.getShipmentsToValidate(),
        this.shipmentsService.getSimpleChargeShipments(),
      ]);
      const items: TrackableItem[] = [
        ...shipments.map((entity) => ({ kind: 'shipment' as const, entity })),
        ...charges.map((entity) => ({ kind: 'charge' as const, entity })),
      ];
      if (!items.length) {
        this.logger.log('📪 [shadow] no hay guías para observar.');
        return;
      }
      this.logger.log(`🌓 [shadow] observando ${shipments.length} normales + ${charges.length} F2...`);
      await this.orchestrator.runShadow(items);
    } catch (err: any) {
      this.logger.error(`❌ [shadow] error: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
