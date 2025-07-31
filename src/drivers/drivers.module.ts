import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { Type } from 'class-transformer';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Driver, Subsidiary } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Driver, Subsidiary])],
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
