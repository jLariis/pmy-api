import { Module } from '@nestjs/common';
import { PickUpService } from './pick-up.service';
import { PickUpController } from './pick-up.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { ChargeShipment, Shipment } from 'src/entities';
import { FedexService } from 'src/shipments/fedex.service';

@Module({
  imports: [TypeOrmModule.forFeature([ForPickUp, Shipment, ChargeShipment])],
  controllers: [PickUpController],
  providers: [PickUpService, FedexService],
  exports: [PickUpService]
})
export class PickUpModule {}
