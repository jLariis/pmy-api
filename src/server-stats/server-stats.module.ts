import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';
import { ServerLogsService } from './server-logs.service';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { ServerPowerSchedule } from '../entities/server-power-schedule.entity';
import { ServerPowerDay } from '../entities/server-power-day.entity';
import { MailModule } from '../mail/mail.module';
import { ServerPowerController } from './power/server-power.controller';
import { ServerPowerService } from './power/server-power.service';
import { PowerApplyRunner } from './power/power-apply.runner';
import { PowerSecretGuard } from './power/power-secret.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ServerPowerSchedule, ServerPowerDay]), MailModule],
  controllers: [ServerStatsController, BackupController, ServerPowerController],
  providers: [
    ServerStatsService,
    ServerLogsService,
    BackupService,
    ServerPowerService,
    PowerApplyRunner,
    PowerSecretGuard,
  ],
})
export class ServerStatsModule {}
