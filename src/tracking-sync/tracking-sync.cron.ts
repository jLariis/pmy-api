import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { RouteUniverseService } from './route-universe.service';
import { prioritizeTrackables } from './cadence/prioritize.util';
import { isCutoverEnabled } from './cutover.config';

const START_HOUR = Number(process.env.FEDEX_SYNC_START_HOUR || 7);
const END_HOUR = Number(process.env.FEDEX_SYNC_END_HOUR || 22);

/**
 * SHADOW (observa, NO escribe): cada 15 min en horario hábil (07:00–22:00 Hermosillo), sobre
 * las guías de las RUTAS DEL DÍA — la MISMA cadencia y universo que usará el motor al encender
 * el cutover, para que la paridad refleje la operación real. Anota qué estatus pondría el motor
 * vs el actual (tracking_sync_observation) sin tocar nada. Se apaga cuando el cutover está ON
 * (ahí el motor ya escribe y el shadow sería una 2ª pasada redundante a FedEx).
 */
@Injectable()
export class TrackingSyncCron {
  private readonly logger = new Logger(TrackingSyncCron.name);
  private isRunning = false;

  constructor(
    private readonly orchestrator: TrackingSyncOrchestrator,
    private readonly routeUniverse: RouteUniverseService,
  ) {}

  @Cron('0 */15 * * * *') // cada 15 minutos
  async handleShadowSync() {
    if (isCutoverEnabled()) return; // con cutover ON el motor ya escribe; no dupliques FedEx
    const hour = this.routeUniverse.hermosilloHour();
    if (hour < START_HOUR || hour >= END_HOUR) return; // fuera de horario hábil
    if (this.isRunning) {
      this.logger.warn('⏭️ [shadow] corrida anterior en curso; se omite este disparo.');
      return;
    }
    this.isRunning = true;
    try {
      const rawItems = await this.routeUniverse.todayRouteItems();
      if (!rawItems.length) {
        this.logger.log('📪 [shadow] sin guías de ruta para observar.');
        return;
      }
      const items = prioritizeTrackables(rawItems);
      this.logger.log(`🌓 [shadow] observando ${items.length} guías de las rutas del día...`);
      await this.orchestrator.runShadow(items);
    } catch (err: any) {
      this.logger.error(`❌ [shadow] error: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
