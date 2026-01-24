import { Module } from '@nestjs/common';
import { TrackingCronService } from './tracking.cron.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';
import { DHLService } from 'src/shipments/dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Charge } from 'src/entities/charge.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { MailService } from 'src/mail/mail.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { UnloadingService } from 'src/unloading/unloading.service';
import { Unloading } from 'src/entities/unloading.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Shipment, ShipmentStatus,Subsidiary, Income, ChargeShipment, Charge, Consolidated, ForPickUp, Unloading, PackageDispatch])],
    providers: [TrackingCronService, ShipmentsService, FedexService, DHLService, SubsidiariesService, ConsolidatedService, MailService, UnloadingService],
})
export class TrackingModule {}
