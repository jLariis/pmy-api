import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpsAlert, OpsAlertSettings, OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsappGatewayModule } from '../whatsapp-gateway/whatsapp-gateway.module';
import { LifecycleService } from './lifecycle.service';
import { OpsAlertsService } from './ops-alerts.service';
import { OpsAlertsController } from './ops-alerts.controller';

/** Revisor de alertas operativas cada 5 minutos (respeta el interruptor y el horario activo). */
@Injectable()
export class OpsAlertsCron {
  private readonly logger = new Logger(OpsAlertsCron.name);
  constructor(private readonly service: OpsAlertsService) {}

  @Cron('0 */5 * * * *', { timeZone: 'America/Hermosillo' })
  async run(): Promise<void> {
    try {
      await this.service.evaluate();
    } catch (e: any) {
      this.logger.error(`⏰ [ops-alerts] ${e?.message ?? e}`);
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([OpsAlert, OpsAlertSettings, OpsAlertSubsidiary, InboxConsolidation]), NotificationsModule, WhatsappGatewayModule],
  controllers: [OpsAlertsController],
  providers: [LifecycleService, OpsAlertsService, OpsAlertsCron],
  exports: [OpsAlertsService, LifecycleService],
})
export class OpsAlertsModule {}
