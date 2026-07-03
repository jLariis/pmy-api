import { Module } from '@nestjs/common';
import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';
import { ServerLogsService } from './server-logs.service';

@Module({
  controllers: [ServerStatsController],
  providers: [ServerStatsService, ServerLogsService],
})
export class ServerStatsModule {}
