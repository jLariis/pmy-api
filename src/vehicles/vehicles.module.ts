import { Module } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subsidiary, Vehicle } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, Subsidiary])],
  controllers: [VehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
