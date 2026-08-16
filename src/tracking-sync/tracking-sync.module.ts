import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { TrackingSyncRun } from 'src/entities/tracking-sync-run.entity';
import { TrackingSyncObservation } from 'src/entities/tracking-sync-observation.entity';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsModule } from 'src/shipments/shipments.module';
import { AuditModule } from 'src/audit/audit.module';
import { TrackingNormalizer } from './tracking-normalizer';
import { EventReconciler } from './event-reconciler';
import { SyncRulesPipeline } from './sync-rules.pipeline';
import { ExistingEventLoader } from './existing-event-loader';
import { FedexTrackingSource } from './sources/fedex-tracking.source';
import { ShadowSyncSink } from './sinks/shadow-sync.sink';
import { PersistentSyncSink } from './sinks/persistent-sync.sink';
import { TrackingCompareService } from './tracking-compare.service';
import { TrackingSyncController } from './tracking-sync.controller';
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
    TypeOrmModule.forFeature([Shipment, ChargeShipment, ShipmentStatus, PackageDispatchHistory, TrackingSyncRun, TrackingSyncObservation]),
    ShipmentsModule, // para ShipmentsService.getShipmentsToValidate()
    AuditModule, // para AuditService (registro de correcciones manuales)
  ],
  controllers: [TrackingSyncController],
  providers: [
    FedexService,
    TrackingNormalizer,
    EventReconciler,
    SyncRulesPipeline,
    ExistingEventLoader,
    FedexTrackingSource,
    ShadowSyncSink,
    PersistentSyncSink,
    TrackingCompareService,
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
