import { Module } from '@nestjs/common';
import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';
import { ServerLogsService } from './server-logs.service';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  controllers: [ServerStatsController, BackupController],
  providers: [ServerStatsService, ServerLogsService, BackupService],
})
export class ServerStatsModule {}
