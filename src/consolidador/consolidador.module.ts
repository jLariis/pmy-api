import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, Shipment, Subsidiary } from '../entities';
import { ConsolidadorController } from './consolidador.controller';
import { ConsolidadorReadService } from './read/consolidador-read.service';
import { ConsolidadorIncomeService } from './income/consolidador-income.service';

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment, Subsidiary])],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService, ConsolidadorIncomeService],
})
export class ConsolidadorModule {}
