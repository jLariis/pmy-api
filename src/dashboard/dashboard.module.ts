import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DashboardController } from "./dashboard.controller";
import { KpiService } from "./kpi.service";
import { Charge, ChargeShipment, Consolidated, Expense, Income, Shipment, ShipmentStatus, Subsidiary } from "src/entities";
import { ChargeRulesModule } from "src/charge-rules/charge-rules.module";
import { FedexStatusModule } from "src/fedex-status/fedex-status.module";
import { ConsolidatedModule } from "src/consolidated/consolidated.module";

@Module({
  imports: [TypeOrmModule.forFeature([Expense, Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary]), ChargeRulesModule, FedexStatusModule, ConsolidatedModule],
  controllers: [DashboardController],
  providers: [KpiService],
  exports: [KpiService]
})
export class DashboardModule {}