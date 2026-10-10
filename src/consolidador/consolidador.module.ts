import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, IncomeChangeLog, Shipment, Subsidiary } from '../entities';
import { ConsolidadorController } from './consolidador.controller';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorGroupsService } from './read/consolidador-groups.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';
import { ConsolidadorStatusService } from './status/consolidador-status.service';
import { ConsolidadorAuditService } from './audit/consolidador-audit.service';
import { CobrosAuditService } from './audit/cobros-audit.service';
import { FedexStatusModule } from '../fedex-status/fedex-status.module';
import { ChargeRulesModule } from '../charge-rules/charge-rules.module';
import { FedexService } from '../shipments/fedex.service';
import { ManualCountService } from './audit/manual-count.service';
import { IncomeDateRealignService } from './income/income-date-realign.service';

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment, Subsidiary, IncomeChangeLog]), FedexStatusModule, ChargeRulesModule],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService, ConsolidadorGroupsService, ConsolidadorIncomeService, ConsolidadorStatusService, ConsolidadorAuditService, CobrosAuditService, ManualCountService, IncomeDateRealignService, FedexService],
})
export class ConsolidadorModule {}
