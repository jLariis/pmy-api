import { Module } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { InventoriesController } from './inventories.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment, ChargeShipment, Consolidated, Charge, Subsidiary } from 'src/entities';
import { Inventory } from 'src/entities/inventory.entity';
import { MailService } from 'src/mail/mail.service';
import { DocumentsModule } from 'src/documents/documents.module';

@Module({
  imports: [TypeOrmModule.forFeature([Inventory, Shipment, ChargeShipment, Consolidated, Charge, Subsidiary]), DocumentsModule],
  controllers: [InventoriesController],
  providers: [InventoriesService, MailService],
})
export class InventoriesModule {}
