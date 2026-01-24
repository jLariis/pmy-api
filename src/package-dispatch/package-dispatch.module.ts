import { Module } from '@nestjs/common';
import { PackageDispatchService } from './package-dispatch.service';
import { PackageDispatchController } from './package-dispatch.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { Devolution } from 'src/entities/devolution.entity';
import { MailService } from 'src/mail/mail.service';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { DHLService } from 'src/shipments/dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { Unloading } from 'src/entities/unloading.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PackageDispatch, Shipment, ChargeShipment, Subsidiary, Consolidated, Devolution, Income, Charge, ShipmentStatus, ForPickUp, Unloading])], // Add your entities here
  controllers: [PackageDispatchController],
  providers: [PackageDispatchService, MailService, FedexService, ShipmentsService, DHLService, SubsidiariesService, ConsolidatedService],
})
export class PackageDispatchModule {}
