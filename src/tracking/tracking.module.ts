import { Module } from '@nestjs/common';
import { TrackingCronService } from './tracking.cron.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, Shipment, Subsidiary } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';
import { DHLService } from 'src/shipments/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';

@Module({
    imports: [TypeOrmModule.forFeature([Shipment, Subsidiary, Income])],
    providers: [TrackingCronService, ShipmentsService, FedexService, DHLService, SubsidiariesService],
})
export class TrackingModule {}
