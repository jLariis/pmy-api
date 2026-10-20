import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { RouteUniverseService } from './route-universe.service';
import { prioritizeTrackables } from './cadence/prioritize.util';
import { cutoverMode, isEngineHour, isSubsidiaryInCutover } from './cutover.config';

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
    // 'full': el motor ya escribe todo → no hay nada que observar. 'coexist': se sigue observando
    // a las sucursales FUERA del piloto, para medir paridad antes de ampliarlo.
    const mode = cutoverMode();
    if (mode === 'full') return;
    if (!isEngineHour(this.routeUniverse.hermosilloHour())) return; // fuera de horario hábil
    if (this.isRunning) {
      this.logger.warn('⏭️ [shadow] corrida anterior en curso; se omite este disparo.');
      return;
    }
    this.isRunning = true;
    try {
      let rawItems = await this.routeUniverse.todayRouteItems();
      if (mode === 'coexist') rawItems = rawItems.filter((it) => !isSubsidiaryInCutover((it.entity as any)?.subsidiary?.id));
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
