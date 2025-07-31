import { Module } from '@nestjs/common';
import { PackageDispatchService } from './package-dispatch.service';
import { PackageDispatchController } from './package-dispatch.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ChargeShipment, Consolidated, Shipment, Subsidiary } from 'src/entities';
import { Devolution } from 'src/entities/devolution.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PackageDispatch, Shipment, ChargeShipment, Subsidiary, Consolidated, Devolution])], // Add your entities here
  controllers: [PackageDispatchController],
  providers: [PackageDispatchService],
})
export class PackageDispatchModule {}
