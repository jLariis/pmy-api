import { Module } from '@nestjs/common';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';
import { Expense, RouteIncome, Shipment } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Collection } from 'src/entities/collection.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RouteIncome, Shipment, Expense, Collection])],
  controllers: [IncomeController],
  providers: [IncomeService],
  exports: [IncomeService],
})
export class IncomeModule {}
