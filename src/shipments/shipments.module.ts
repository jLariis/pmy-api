import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from '../entities/shipment.entity';
import { ShipmentsService } from './shipments.service';
import { FedexService } from './fedex.service';
import { TrackingModule } from 'src/tracking/tracking.module';
import { DHLService } from './dhl.service';

@Module({
  controllers: [ShipmentsController],
  imports: [TypeOrmModule.forFeature([Shipment]),TrackingModule],
  providers: [ShipmentsService, FedexService, DHLService],
  exports: [ShipmentsService],
})
export class ShipmentsModule { }
