import { Module } from '@nestjs/common';
import { PickUpService } from './pick-up.service';
import { PickUpController } from './pick-up.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { ChargeShipment, Shipment, ShipmentStatus, WarehouseDelivery } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([ForPickUp, Shipment, ChargeShipment, ShipmentStatus, WarehouseDelivery])],
  controllers: [PickUpController],
  providers: [PickUpService],
  exports: [PickUpService],
})
export class PickUpModule {}
