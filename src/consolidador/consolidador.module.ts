import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, IncomeChangeLog, Shipment, Subsidiary } from '../entities';
import { ConsolidadorController } from './consolidador.controller';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';
import { ConsolidadorStatusService } from './status/consolidador-status.service';
import { ConsolidadorAuditService } from './audit/consolidador-audit.service';
import { FedexStatusModule } from '../fedex-status/fedex-status.module';

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment, Subsidiary, IncomeChangeLog]), FedexStatusModule],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService, ConsolidadorIncomeService, ConsolidadorStatusService, ConsolidadorAuditService],
})
export class ConsolidadorModule {}
