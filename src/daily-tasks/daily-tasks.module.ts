import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyTask } from '../entities/daily-task.entity';
import { DailyLd } from '../entities/daily-ld.entity';
import { OpsAlert, OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { OpsAlertsModule } from '../ops-alerts/ops-alerts.module';
import { DailyTaskFactsService } from './daily-task-facts.service';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTasksController } from './daily-tasks.controller';
import { DailyTasksNotifier } from './daily-tasks.cron';

/** Tareas del día: checklist automático por consolidado y por sucursal, con avisos. */
@Module({
  imports: [TypeOrmModule.forFeature([DailyTask, DailyLd, OpsAlert, OpsAlertSubsidiary]), OpsAlertsModule],
  controllers: [DailyTasksController],
  providers: [DailyTaskFactsService, DailyTasksService, DailyTasksNotifier],
  exports: [DailyTasksService],
})
export class DailyTasksModule {}
