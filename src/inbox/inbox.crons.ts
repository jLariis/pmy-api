import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { InboxIngestService } from './inbox-ingest.service';
import { InboxLinkService } from './inbox-link.service';
import { ZipCoverageService } from './zip-coverage.service';
import { SystemMatchService } from './system-match.service';

/** Crons de la bandeja FedEx (hora de Hermosillo). La lectura respeta el interruptor. */
@Injectable()
export class InboxCrons implements OnApplicationBootstrap {
  private readonly logger = new Logger(InboxCrons.name);
  private linking = false;
  private rebuilding = false;

  constructor(
    private readonly ingest: InboxIngestService,
    private readonly link: InboxLinkService,
    private readonly coverage: ZipCoverageService,
    private readonly systemMatch: SystemMatchService,
    private readonly ds: DataSource,
  ) {}

  /** Si la cobertura de CP está vacía (primer arranque), se arma en segundo plano. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const r: any[] = await this.ds.query('SELECT COUNT(*) AS n FROM subsidiary_zip_coverage');
      if (Number(r[0]?.n ?? 0) === 0) setTimeout(() => void this.rebuildCoverage(), 30_000);
    } catch {
      // La tabla aún no existe (migración pendiente): no bloquear el arranque.
    }
  }

  @Cron('0 */2 * * * *', { timeZone: 'America/Hermosillo' })
  async readMailbox(): Promise<void> {
    try {
      await this.ingest.runSync(false);
    } catch (e: any) {
      this.logger.error(`📭 [inbox] lectura: ${e?.message ?? e}`);
    }
  }

  @Cron('30 */5 * * * *', { timeZone: 'America/Hermosillo' })
  async linkUploads(): Promise<void> {
    if (this.linking) return;
    this.linking = true;
    try {
      await this.link.linkPending();
      // Por guías: detecta subidas con número propio de la sucursal (Hermosillo, rutas locales).
      await this.systemMatch.matchRecent();
    } catch (e: any) {
      this.logger.error(`🔗 [inbox] ligado: ${e?.message ?? e}`);
    } finally {
      this.linking = false;
    }
  }

  @Cron('0 30 3 * * *', { timeZone: 'America/Hermosillo' })
  async rebuildCoverage(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      await this.coverage.rebuildFromHistory();
    } catch (e: any) {
      this.logger.error(`🗺️ [inbox] cobertura CP: ${e?.message ?? e}`);
    } finally {
      this.rebuilding = false;
    }
  }
}
