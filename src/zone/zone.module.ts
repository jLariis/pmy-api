import { Module } from '@nestjs/common';
import { ZoneService } from './zone.service';
import { ZoneController } from './zone.controller';
import { Zone } from 'src/entities';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Zone])], // Add your entities here
  controllers: [ZoneController],
  providers: [ZoneService],
})
export class ZoneModule {}
