import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { RouteCoverageService } from './route-coverage.service';

/**
 * Recalcula los CPs por ruta cada mañana (06:30 Hermosillo: el servidor se suspende
 * de 21:30 a 06:00). Si al arrancar está vacía o con más de un día sin recalcular, se arma
 * en segundo plano.
 */
@Injectable()
export class RouteCoverageCrons implements OnApplicationBootstrap {
  private readonly logger = new Logger(RouteCoverageCrons.name);
  private running = false;

  constructor(
    private readonly coverage: RouteCoverageService,
    private readonly ds: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Vacía o sin recalcular en más de un día (p. ej. base restaurada, o el servidor estuvo
      // apagado a las 06:30): se arma en segundo plano para no dejar CPs viejos o incompletos.
      const r: any[] = await this.ds.query(
        'SELECT COUNT(*) AS n, MAX(updatedAt) < DATE_SUB(NOW(), INTERVAL 1 DAY) AS stale FROM route_zip_coverage',
      );
      if (Number(r[0]?.n ?? 0) === 0 || Number(r[0]?.stale ?? 0) === 1) setTimeout(() => void this.rebuild(), 45_000);
    } catch {
      // La tabla aún no existe (migración 120 pendiente): no bloquear el arranque.
    }
  }

  @Cron('0 30 6 * * *', { timeZone: 'America/Hermosillo' })
  async rebuild(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.coverage.rebuildFromHistory();
      this.logger.log(`CPs por ruta recalculados: ${r.pairs} combinaciones ruta-CP (${r.days} días)`);
    } catch (e: any) {
      this.logger.error(`No se pudieron recalcular los CPs por ruta: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
