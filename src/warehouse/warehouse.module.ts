import { Module } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { ChargeShipment, Shipment } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Shipment, ChargeShipment])],
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {
  
}
