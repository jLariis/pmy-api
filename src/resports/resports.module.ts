import { Module } from '@nestjs/common';
import { ResportsService } from './resports.service';
import { ResportsController } from './resports.controller';
import { Expense, Income, Subsidiary } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from 'src/documents/documents.module';
import { ChargeRulesModule } from 'src/charge-rules/charge-rules.module';

@Module({
  controllers: [ResportsController],
  imports: [TypeOrmModule.forFeature([Expense, Income, Subsidiary]), DocumentsModule, ChargeRulesModule],
  providers: [ResportsService],
})
export class ResportsModule {}
