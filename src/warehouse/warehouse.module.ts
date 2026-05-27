import { Module } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { ChargeShipment, PackageDispatch, Shipment, ShipmentRemittance, WarehouseReceiving } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([
    WarehouseReceiving,
    ShipmentRemittance,
    Shipment,
    ChargeShipment,
    PackageDispatch
  ])],
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {
  
}
