import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChargeRule } from 'src/entities/charge-rule.entity';
import { ChargeRulesService } from './charge-rules.service';
import { ChargeRulesController } from './charge-rules.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ChargeRule])],
  controllers: [ChargeRulesController],
  providers: [ChargeRulesService],
  exports: [ChargeRulesService],
})
export class ChargeRulesModule {}
