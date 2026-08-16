import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsModule } from 'src/shipments/shipments.module';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { ExistingEventLoader } from './existing-event-loader';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { ShadowSyncSink } from './sinks/shadow-sync.sink';
import { TrackingSyncOrchestrator } from './tracking-sync.orchestrator';
import { TrackingSyncCron } from './tracking-sync.cron';
import { TerminalLockRule } from './rules/terminal-lock.rule';
import { ExternalDeliveryRule } from './rules/external-delivery.rule';
import { IncomeRule } from './rules/income.rule';
import { NotificationRule } from './rules/notification.rule';
import { SYNC_RULES } from './tracking-sync.types';

/**
 * Motor de sincronización de estados de tracking (FedEx), SHADOW mode.
 * Aislado del monolito shipments.service. Las reglas se inyectan por el token SYNC_RULES;
 * agregar una regla = un provider más aquí, sin tocar el pipeline.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentStatus, TrackingSyncRun, TrackingSyncObservation]),
    ShipmentsModule, // para ShipmentsService.getShipmentsToValidate()
  ],
  providers: [
    FedexService,
    TrackingNormalizer,
    EventReconciler,
    SyncRulesPipeline,
    ExistingEventLoader,
    FedexTrackingSource,
    ShadowSyncSink,
    TrackingSyncOrchestrator,
    TrackingSyncCron,
    TerminalLockRule,
    ExternalDeliveryRule,
    IncomeRule,
    NotificationRule,
    {
      provide: SYNC_RULES,
      useFactory: (terminal, external, income, notification) => [terminal, external, income, notification],
      inject: [TerminalLockRule, ExternalDeliveryRule, IncomeRule, NotificationRule],
    },
  ],
})
export class TrackingSyncModule {}
