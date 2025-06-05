import { Module } from '@nestjs/common';
import { TrackingCronService } from './tracking.cron.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';
import { DHLService } from 'src/shipments/dhl.service';

@Module({
    imports: [TypeOrmModule.forFeature([Shipment])],
    providers: [TrackingCronService, ShipmentsService, FedexService, DHLService],
})
export class TrackingModule {}
