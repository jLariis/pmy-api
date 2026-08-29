import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CobrosReconciliationService } from './cobros-reconciliation.service';

/**
 * Guardia diaria de cobros (read-only). Corre 07:00 Hermosillo (tras el enriquecimiento
 * horario) y reporta discrepancias; si superan el umbral SLA, emite WARN de alerta.
 */
@Injectable()
export class CobrosReconciliationCron {
  private readonly logger = new Logger(CobrosReconciliationCron.name);
  private static readonly SLA_THRESHOLD = 25; // discrepancias que disparan alerta

  constructor(private readonly service: CobrosReconciliationService) {}

  @Cron('0 0 7 * * *', { timeZone: 'America/Hermosillo' })
  async handleDailyReconcile(): Promise<void> {
    try {
      const r = await this.service.reconcileAndPersist(14);
      this.logger.log(
        `🧮 [cobros-recon] entregados(14d)=${r.deliveredShipments} · sin ingreso=${r.missingCount} · ingreso huérfano=${r.orphanCount}`,
      );
      const total = r.missingCount + r.orphanCount;
      if (total >= CobrosReconciliationCron.SLA_THRESHOLD) {
        this.logger.warn(
          `🚨 [cobros-recon][SLA] ${total} discrepancias de cobro (sin ingreso: ${r.missingIncome.slice(0, 20).join(', ')}${r.missingCount > 20 ? '…' : ''} | huérfanos: ${r.orphanIncome.slice(0, 20).join(', ')}${r.orphanCount > 20 ? '…' : ''})`,
        );
      }
    } catch (e: any) {
      this.logger.error(`[cobros-recon] error: ${e?.message}`);
    }
  }
}
