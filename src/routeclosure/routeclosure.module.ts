import { Module } from '@nestjs/common';
import { RouteclosureService } from './routeclosure.service';
import { RouteclosureController } from './routeclosure.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RouteClosure])],
  controllers: [RouteclosureController],
  providers: [RouteclosureService],
})
export class RouteclosureModule {}
