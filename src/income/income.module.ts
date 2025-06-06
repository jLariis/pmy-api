import { Module } from '@nestjs/common';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';
import { RouteIncome } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([RouteIncome])],
  controllers: [IncomeController],
  providers: [IncomeService],
})
export class IncomeModule {}
