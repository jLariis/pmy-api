import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { FedexService } from 'src/shipments/fedex.service';
import { MailService } from 'src/mail/mail.service';
import { PackageDispatchService } from 'src/package-dispatch/package-dispatch.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment, ChargeShipment, Consolidated, Subsidiary, Devolution, Income, Charge, ShipmentStatus } from 'src/entities';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { DHLService } from 'src/shipments/dto/dhl.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shipment, ChargeShipment, Consolidated, Subsidiary, PackageDispatch, Devolution, RouteClosure, Income, Charge, ShipmentStatus, ForPickUp])],
  controllers: [MonitoringController],
  providers: [MonitoringService, FedexService, SubsidiariesService, DHLService, MailService, PackageDispatchService, ShipmentsService, ConsolidatedService],
})
export class MonitoringModule {}
