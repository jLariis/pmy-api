import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, Shipment, Subsidiary } from '../entities';
import { ConsolidadorController } from './consolidador.controller';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';
import { ConsolidadorStatusService } from './status/consolidador-status.service';
import { FedexStatusModule } from '../fedex-status/fedex-status.module';

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment, Subsidiary]), FedexStatusModule],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService, ConsolidadorIncomeService, ConsolidadorStatusService],
})
export class ConsolidadorModule {}
