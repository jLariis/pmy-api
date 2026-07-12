import { Module } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { ChargeShipment, PackageDispatch, Shipment, ShipmentRemittance, WarehouseOutbound, WarehouseReceiving } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from 'src/mail/mail.service';
import { DocumentsModule } from 'src/documents/documents.module';

@Module({
  imports: [TypeOrmModule.forFeature([
    WarehouseReceiving,
    WarehouseOutbound,
    ShipmentRemittance,
    Shipment,
    ChargeShipment,
    PackageDispatch
  ]), DocumentsModule],
  controllers: [WarehouseController],
  providers: [
    WarehouseService,
    MailService
  ],
})
export class WarehouseModule { }
