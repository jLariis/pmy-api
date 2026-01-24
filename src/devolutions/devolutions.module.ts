import { Module } from '@nestjs/common';
import { DevolutionsService } from './devolutions.service';
import { DevolutionsController } from './devolutions.controller';
import { Devolution } from 'src/entities/devolution.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { MailService } from 'src/mail/mail.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { DHLService } from 'src/shipments/dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Unloading } from 'src/entities/unloading.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Devolution, Shipment, ShipmentStatus, Subsidiary, Income, Charge, ChargeShipment, Consolidated, ForPickUp, PackageDispatch, Unloading])],
  controllers: [DevolutionsController],
  providers: [DevolutionsService, MailService, FedexService, DHLService, SubsidiariesService, ConsolidatedService, ShipmentsService],
})
export class DevolutionsModule {}
