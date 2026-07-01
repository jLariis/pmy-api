import { Module } from '@nestjs/common';
import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';

@Module({
  controllers: [ServerStatsController],
  providers: [ServerStatsService],
})
export class ServerStatsModule {}
