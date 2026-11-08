import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { RouteCoverageService } from './route-coverage.service';

/**
 * Recalcula los CPs por ruta cada mañana (06:30 Hermosillo: el servidor se suspende
 * de 21:30 a 06:00). Si la tabla está vacía al arrancar, se arma en segundo plano.
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
      const r: any[] = await this.ds.query('SELECT COUNT(*) AS n FROM route_zip_coverage');
      if (Number(r[0]?.n ?? 0) === 0) setTimeout(() => void this.rebuild(), 45_000);
    } catch {
      // La tabla aún no existe (migración 120 pendiente): no bloquear el arranque.
    }
  }

  @Cron('0 30 6 * * *', { timeZone: 'America/Hermosillo' })
  async rebuild(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.coverage.rebuildFromHistory();
    } catch (e: any) {
      this.logger.error(`No se pudieron recalcular los CPs por ruta: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
