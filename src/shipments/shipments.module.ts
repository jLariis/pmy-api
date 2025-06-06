import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from '../entities/shipment.entity';
import { ShipmentsService } from './shipments.service';
import { FedexService } from './fedex.service';
import { TrackingModule } from 'src/tracking/tracking.module';
import { DHLService } from './dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Subsidiary } from 'src/entities';

@Module({
  controllers: [ShipmentsController],
  imports: [TypeOrmModule.forFeature([Shipment, Subsidiary]),TrackingModule],
  providers: [ShipmentsService, FedexService, DHLService, SubsidiariesService],
  exports: [ShipmentsService],
})
export class ShipmentsModule { }
