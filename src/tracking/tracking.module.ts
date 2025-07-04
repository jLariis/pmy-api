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

@Module({
    imports: [TypeOrmModule.forFeature([Shipment, ShipmentStatus,Subsidiary, Income, ChargeShipment, Charge, Consolidated])],
    providers: [TrackingCronService, ShipmentsService, FedexService, DHLService, SubsidiariesService, ConsolidatedService],
})
export class TrackingModule {}
