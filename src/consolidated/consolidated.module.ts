import { Module } from '@nestjs/common';
import { ConsolidatedService } from './consolidated.service';
import { ConsolidatedController } from './consolidated.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { FedexService } from 'src/shipments/fedex.service';
import { DHLService } from 'src/shipments/dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { MailService } from 'src/mail/mail.service';
import { ForPickUp } from 'src/entities/for-pick-up.entity';

@Module({
  controllers: [ConsolidatedController],
  imports: [
    TypeOrmModule.forFeature([Consolidated, Shipment, Income, Subsidiary, Charge, ChargeShipment, ShipmentStatus, ForPickUp]),
  ],
  providers: [ConsolidatedService, ShipmentsService, FedexService, DHLService, SubsidiariesService, MailService],
  exports: [ConsolidatedService]
})
export class ConsolidatedModule {}
