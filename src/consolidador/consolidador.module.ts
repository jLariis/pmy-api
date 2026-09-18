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

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment, Subsidiary, IncomeChangeLog]), FedexStatusModule],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService, ConsolidadorGroupsService, ConsolidadorIncomeService, ConsolidadorStatusService, ConsolidadorAuditService, CobrosAuditService],
})
export class ConsolidadorModule {}
