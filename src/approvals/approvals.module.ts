import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from 'src/entities/approval-request.entity';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { User } from 'src/entities/user.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { Income } from 'src/entities/income.entity';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { Charge } from 'src/entities/charge.entity';
import { ConsolidatedChangeLog } from 'src/entities/consolidated-change-log.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { HolidaysModule } from 'src/holidays/holidays.module';
import { ConsolidatedFamilyLoader } from './consolidated-family.loader';
import { ConsolidatedActionsExecutor } from './consolidated-actions.executor';
import { ConsolidatedActionsService } from './consolidated-actions.service';
import { ApprovalsService } from './approvals.service';
import { ApprovalImpactService } from './impact.service';
import { ApprovalsController } from './approvals.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRequest, Subsidiary, User, Consolidated, PackageDispatch, Shipment, ChargeShipment, Income, RouteClosure,
      Charge, ConsolidatedChangeLog,
    ]),
    NotificationsModule,
    HolidaysModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalImpactService, ConsolidatedFamilyLoader, ConsolidatedActionsExecutor, ConsolidatedActionsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
