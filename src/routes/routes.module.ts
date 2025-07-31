import { Module } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route, Subsidiary } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Route, Subsidiary])],
  controllers: [RoutesController],
  providers: [RoutesService],
})
export class RoutesModule {}
