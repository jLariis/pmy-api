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
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ApprovalsService } from './approvals.service';
import { ApprovalImpactService } from './impact.service';
import { ApprovalsController } from './approvals.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRequest, Subsidiary, User, Consolidated, PackageDispatch, Shipment, ChargeShipment, Income, RouteClosure,
    ]),
    NotificationsModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalImpactService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
