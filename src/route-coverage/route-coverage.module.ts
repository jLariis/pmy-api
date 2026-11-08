import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route, RouteZipCoverage } from 'src/entities';
import { RouteCoverageController } from './route-coverage.controller';
import { RouteCoverageService } from './route-coverage.service';
import { RouteCoverageCrons } from './route-coverage.crons';
import { RouteSuggestionService } from './route-suggestion.service';
import { RouteSuggestionController } from './route-suggestion.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RouteZipCoverage, Route])],
  controllers: [RouteCoverageController, RouteSuggestionController],
  providers: [RouteCoverageService, RouteCoverageCrons, RouteSuggestionService],
  exports: [RouteCoverageService, RouteSuggestionService],
})
export class RouteCoverageModule {}
