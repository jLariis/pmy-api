import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from '../entities/shipment.entity';
import { ShipmentsService } from './shipments.service';
import { FedexService } from './fedex.service';
import { TrackingModule } from 'src/tracking/tracking.module';
import { DHLService } from './dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Income, ShipmentStatus, Subsidiary, Charge, ChargeShipment, Consolidated } from 'src/entities';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';

@Module({
  controllers: [ShipmentsController],
  imports: [TypeOrmModule.forFeature([Shipment, ShipmentStatus,Subsidiary, Income, Charge, ChargeShipment, Consolidated]),TrackingModule],
  providers: [ShipmentsService, FedexService, DHLService, SubsidiariesService, ConsolidatedService],
  exports: [ShipmentsService],
})
export class ShipmentsModule { }
