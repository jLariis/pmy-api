import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PackageTransferService } from './package-transfer.service';
import { PackageTransferController } from './package-transfer.controller';
import { Shipment, ShipmentStatus, ChargeShipment, Subsidiary, PackageTransfer } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([PackageTransfer, Shipment, ChargeShipment, ShipmentStatus, Subsidiary])],
  controllers: [PackageTransferController],
  providers: [PackageTransferService],
  exports: [PackageTransferService],
})
export class PackageTransferModule {}
