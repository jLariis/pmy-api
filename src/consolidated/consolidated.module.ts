import { Module } from '@nestjs/common';
import { ConsolidatedService } from './consolidated.service';
import { ConsolidatedController } from './consolidated.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consolidated, Shipment } from 'src/entities';

@Module({
  controllers: [ConsolidatedController],
  imports: [TypeOrmModule.forFeature([Consolidated, Shipment])],
  providers: [ConsolidatedService],
  exports: [ConsolidatedService]
})
export class ConsolidatedModule {}
