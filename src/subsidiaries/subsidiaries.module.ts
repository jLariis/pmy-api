import { Module } from '@nestjs/common';
import { SubsidiariesController } from './subsidiaries.controller';
import { Subsidiary } from 'src/entities';
import { SubsidiariesService } from './subsidiaries.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackingModule } from 'src/tracking/tracking.module';


@Module({
  controllers: [SubsidiariesController],
  imports: [TypeOrmModule.forFeature([Subsidiary]),TrackingModule],
  exports: [SubsidiariesService],
})
export class SubsidiariesModule {}
