import { Module } from '@nestjs/common';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';
import { RouteIncome, Shipment } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentsService } from 'src/shipments/shipments.service';

@Module({
  imports: [TypeOrmModule.forFeature([RouteIncome, Shipment])],
  controllers: [IncomeController],
  providers: [IncomeService],
  exports: [IncomeService],
})
export class IncomeModule {}
