import { Module } from '@nestjs/common';
import { TrackingCronService } from './tracking.cron.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Charge } from 'src/entities/charge.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { MailService } from 'src/mail/mail.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { UnloadingService } from 'src/unloading/unloading.service';
import { Unloading } from 'src/entities/unloading.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { DhlService } from 'src/shipments/dhl.service';
import { WhereParcelDhlService } from 'src/tracking/where-parcel-dhl.service';
import { WhereParcelWebhookController } from 'src/tracking/where-parcel-webhook.controller';
import { AuditLog } from 'src/entities/audit-log.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Shipment, ShipmentStatus,Subsidiary, Income, ChargeShipment, Charge, Consolidated, ForPickUp, Unloading, PackageDispatch, AuditLog])],
    controllers: [WhereParcelWebhookController],
    providers: [TrackingCronService, ShipmentsService, FedexService, DhlService, SubsidiariesService, ConsolidatedService, MailService, UnloadingService, WhereParcelDhlService],
})
export class TrackingModule {}
