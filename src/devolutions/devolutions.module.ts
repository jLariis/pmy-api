import { Module } from '@nestjs/common';
import { DevolutionsService } from './devolutions.service';
import { DevolutionsController } from './devolutions.controller';
import { Devolution } from 'src/entities/devolution.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Charge, ChargeShipment, Collection, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { MailService } from 'src/mail/mail.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { Unloading } from 'src/entities/unloading.entity';
import { DhlService } from 'src/shipments/dhl.service';
import { DocumentsModule } from 'src/documents/documents.module';
import { FedexStatusModule } from 'src/fedex-status/fedex-status.module';
import { HolidaysModule } from 'src/holidays/holidays.module';

@Module({
  imports: [TypeOrmModule.forFeature([Devolution, Shipment, ShipmentStatus, Subsidiary, Income, Charge, ChargeShipment, Consolidated, ForPickUp, PackageDispatch, PackageDispatchHistory, Unloading, Collection]), DocumentsModule, FedexStatusModule, HolidaysModule],
  controllers: [DevolutionsController],
  providers: [DevolutionsService, MailService, FedexService, DhlService, SubsidiariesService, ConsolidatedService, ShipmentsService],
  exports: [DevolutionsService],
})
export class DevolutionsModule {}
