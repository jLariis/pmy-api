import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DashboardController } from "./dashboard.controller";
import { KpiService } from "./kpi.service";
import { Charge, ChargeShipment, Consolidated, Expense, Income, Shipment, ShipmentStatus, Subsidiary } from "src/entities";

@Module({
  imports: [TypeOrmModule.forFeature([Expense, Charge, ChargeShipment, Consolidated, Income, Shipment, ShipmentStatus, Subsidiary])],
  controllers: [DashboardController],
  providers: [KpiService],
  exports: [KpiService]
})
export class DashboardModule {}