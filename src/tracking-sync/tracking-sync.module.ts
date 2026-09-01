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
import { TrackingSyncPersistCron } from './tracking-sync-persist.cron';
import { TerminalLockRule } from './rules/terminal-lock.rule';
import { ExternalDeliveryRule } from './rules/external-delivery.rule';
import { IncomeRule } from './rules/income.rule';
import { NotificationRule } from './rules/notification.rule';
import { DeliveryHeaderRule } from './rules/delivery-header.rule';
import { TimeShieldRule } from './rules/time-shield.rule';
import { PreRegistrationRule } from './rules/pre-registration.rule';
import { PreRegResolvedRule } from './rules/pre-reg-resolved.rule';
import { Code44Rule } from './rules/code44.rule';
import { MetadataPersistRule } from './rules/metadata-persist.rule';
import { IncomeHeaderSafetyNetRule } from './rules/income-header-safety-net.rule';
import { IncomeExecutor } from './income/income-executor';
import { IncomeReconciler } from './income/income-reconciler';
import { CobrosReconciliationService } from './income/cobros-reconciliation.service';
import { CobrosReconciliationCron } from './income/cobros-reconciliation.cron';
import { ParityService } from './parity/parity.service';
import { RouteUniverseService } from './route-universe.service';
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
    TrackingSyncPersistCron,
    TerminalLockRule,
    ExternalDeliveryRule,
    IncomeRule,
    NotificationRule,
    DeliveryHeaderRule,
    TimeShieldRule,
    PreRegistrationRule,
    PreRegResolvedRule,
    Code44Rule,
    MetadataPersistRule,
    IncomeHeaderSafetyNetRule,
    IncomeExecutor,
    IncomeReconciler,
    CobrosReconciliationService,
    CobrosReconciliationCron,
    ParityService,
    RouteUniverseService,
    {
      provide: SYNC_RULES,
      // El pipeline ordena por `priority` (mayor primero); el orden aquí es indiferente.
      useFactory: (terminal, external, income, notification, deliveryHeader, timeShield, preReg, preRegResolved, code44, metadata, incomeHeader) =>
        [terminal, external, income, notification, deliveryHeader, timeShield, preReg, preRegResolved, code44, metadata, incomeHeader],
      inject: [TerminalLockRule, ExternalDeliveryRule, IncomeRule, NotificationRule, DeliveryHeaderRule, TimeShieldRule, PreRegistrationRule, PreRegResolvedRule, Code44Rule, MetadataPersistRule, IncomeHeaderSafetyNetRule],
    },
  ],
  // Exportado para que el cierre a ruta reconcile/persista el estatus FedEx al abrir
  // (RouteclosureService.reconcileRouteWithFedex).
  exports: [TrackingCompareService],
})
export class TrackingSyncModule {}
