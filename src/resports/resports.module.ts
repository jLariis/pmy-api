import { Module } from '@nestjs/common';
import { ResportsService } from './resports.service';
import { ResportsController } from './resports.controller';
import { Expense, Income, Subsidiary } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  controllers: [ResportsController],
  imports: [TypeOrmModule.forFeature([Expense, Income, Subsidiary])],
  providers: [ResportsService],
})
export class ResportsModule {}
