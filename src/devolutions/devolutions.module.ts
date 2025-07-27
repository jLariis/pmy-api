import { Module } from '@nestjs/common';
import { DevolutionsService } from './devolutions.service';
import { DevolutionsController } from './devolutions.controller';
import { Devolution } from 'src/entities/devolution.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChargeShipment, Income, Shipment } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Devolution, Shipment, Income, ChargeShipment])],
  controllers: [DevolutionsController],
  providers: [DevolutionsService],
})
export class DevolutionsModule {}
