import { Module } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { UnloadingController } from './unloading.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { MailService } from 'src/mail/mail.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { DHLService } from 'src/shipments/dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';

@Module({
  imports: [TypeOrmModule.forFeature([Unloading, Shipment, ChargeShipment, Consolidated, Charge, Income, Subsidiary, ShipmentStatus, ForPickUp])],
  controllers: [UnloadingController],
  providers: [UnloadingService, MailService, ShipmentsService, FedexService, DHLService, SubsidiariesService, ConsolidatedService],
})
export class UnloadingModule {}
