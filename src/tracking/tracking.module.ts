import { Module } from '@nestjs/common';
import { TrackingCronService } from './tracking.cron.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';

@Module({
    imports: [TypeOrmModule.forFeature([Shipment])],
    providers: [TrackingCronService, ShipmentsService, FedexService],
})
export class TrackingModule {}
