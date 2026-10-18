import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyTask } from '../entities/daily-task.entity';
import { DailyLd } from '../entities/daily-ld.entity';
import { OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { OpsAlertsModule } from '../ops-alerts/ops-alerts.module';
import { DailyTaskFactsService } from './daily-task-facts.service';
import { DailyTasksService } from './daily-tasks.service';

/** Tareas del día: checklist automático por consolidado y por sucursal, con avisos. */
@Module({
  imports: [TypeOrmModule.forFeature([DailyTask, DailyLd, OpsAlertSubsidiary]), OpsAlertsModule],
  providers: [DailyTaskFactsService, DailyTasksService],
  exports: [DailyTasksService],
})
export class DailyTasksModule {}
