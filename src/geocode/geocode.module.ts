import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeocodeController } from './geocode.controller';
import { GeocodeService } from './geocode.service';
import { GeocodeCache } from '../entities/geocode-cache.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GeocodeCache])],
  controllers: [GeocodeController],
  providers: [GeocodeService],
  exports: [GeocodeService],
})
export class GeocodeModule {}
