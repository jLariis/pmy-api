import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from '../entities/shipment.entity';
import { ShipmentsService } from './shipments.service';
import { FedexService } from './fedex.service';
import { TrackingModule } from 'src/tracking/tracking.module';
import { DHLService } from './dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Income, ShipmentStatus, Subsidiary } from 'src/entities';
import { Charge } from 'src/entities/charge.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';

@Module({
  controllers: [ShipmentsController],
  imports: [TypeOrmModule.forFeature([Shipment, ShipmentStatus,Subsidiary, Income, Charge, ChargeShipment]),TrackingModule],
  providers: [ShipmentsService, FedexService, DHLService, SubsidiariesService],
  exports: [ShipmentsService],
})
export class ShipmentsModule { }
