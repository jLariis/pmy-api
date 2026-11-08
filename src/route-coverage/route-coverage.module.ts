import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route, RouteZipCoverage } from 'src/entities';
import { RouteCoverageController } from './route-coverage.controller';
import { RouteCoverageService } from './route-coverage.service';
import { RouteCoverageCrons } from './route-coverage.crons';

@Module({
  imports: [TypeOrmModule.forFeature([RouteZipCoverage, Route])],
  controllers: [RouteCoverageController],
  providers: [RouteCoverageService, RouteCoverageCrons],
  exports: [RouteCoverageService],
})
export class RouteCoverageModule {}
