import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Income, Shipment } from '../entities';
import { ConsolidadorController } from './consolidador.controller';
import { ConsolidadorReadService } from './read/consolidador-read.service';

@Module({
  imports: [TypeOrmModule.forFeature([Income, Shipment])],
  controllers: [ConsolidadorController],
  providers: [ConsolidadorReadService],
})
export class ConsolidadorModule {}
