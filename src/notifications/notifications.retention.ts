import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Notification } from 'src/entities/notification.entity';

@Injectable()
export class NotificationsRetentionService {
  private readonly logger = new Logger(NotificationsRetentionService.name);
  constructor(@InjectRepository(Notification) private readonly repo: Repository<Notification>) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune() {
    const days = Number(process.env.NOTIFICATIONS_RETENTION_DAYS ?? 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const res = await this.repo.delete({ read: true, createdAt: LessThan(cutoff) });
      this.logger.log(`Poda de notificaciones: ${res.affected ?? 0} filas (> ${days} días, leídas).`);
    } catch (e: any) {
      this.logger.warn(`Poda de notificaciones falló: ${e?.message}`);
    }
  }
}
