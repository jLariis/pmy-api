import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { ServerPowerSchedule } from '../../entities/server-power-schedule.entity';
import { ServerPowerDay } from '../../entities/server-power-day.entity';
import { MailService } from '../../mail/mail.service';
import { PowerApplyRunner } from './power-apply.runner';
import { UpdatePowerScheduleDto } from './dto/update-power-schedule.dto';
import { buildDesired, computeNextEvents, normalizeDays } from './power-schedule.util';

export interface PowerScheduleView {
  enabled: boolean;
  suspendTime: string;
  wakeTime: string;
  days: number[];
  recipients: string[];
  status: {
    nextSuspend: string | null;
    nextWake: string | null;
    timerActive: boolean;
    lastAppliedAt: string | null;
    lastApplyError: string | null;
  };
}

@Injectable()
export class ServerPowerService {
  private readonly logger = new Logger(ServerPowerService.name);

  constructor(
    @InjectRepository(ServerPowerSchedule)
    private readonly schedRepo: Repository<ServerPowerSchedule>,
    @InjectRepository(ServerPowerDay)
    private readonly dayRepo: Repository<ServerPowerDay>,
    private readonly runner: PowerApplyRunner,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private async getRow(): Promise<ServerPowerSchedule> {
    let row = await this.schedRepo.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!row) row = await this.schedRepo.save(this.schedRepo.create({}));
    return row;
  }

  private async activeDays(): Promise<number[]> {
    const rows = await this.dayRepo.find();
    return normalizeDays(rows.filter((r) => r.active).map((r) => r.dayOfWeek));
  }

  async get(): Promise<PowerScheduleView> {
    const row = await this.getRow();
    let days: number[] = [];
    try {
      days = await this.activeDays();
    } catch {
      days = [];
    }
    const { nextSuspend, nextWake } = computeNextEvents(
      new Date(),
      days,
      row.suspendTime,
      row.wakeTime,
      row.enabled,
    );
    const timerActive = await this.runner.isTimerActive().catch(() => false);
    return {
      enabled: row.enabled,
      suspendTime: row.suspendTime,
      wakeTime: row.wakeTime,
      days,
      recipients: row.recipients ?? [],
      status: {
        nextSuspend: nextSuspend ? nextSuspend.toISOString() : null,
        nextWake: nextWake ? nextWake.toISOString() : null,
        timerActive,
        lastAppliedAt: row.lastAppliedAt ? row.lastAppliedAt.toISOString() : null,
        lastApplyError: row.lastApplyError ?? null,
      },
    };
  }

  async update(dto: UpdatePowerScheduleDto, userId?: string): Promise<PowerScheduleView> {
    const days = normalizeDays(dto.days);

    const row = await this.getRow();
    row.enabled = dto.enabled;
    row.suspendTime = dto.suspendTime;
    row.wakeTime = dto.wakeTime;
    row.recipients = dto.recipients;
    row.updatedById = userId ?? null;
    await this.schedRepo.save(row);

    const dayRows = await this.dayRepo.find();
    for (const dr of dayRows) {
      const shouldBeActive = days.includes(dr.dayOfWeek);
      if (dr.active !== shouldBeActive) {
        dr.active = shouldBeActive;
        await this.dayRepo.save(dr);
      }
    }

    const desired = buildDesired({
      enabled: dto.enabled,
      suspendTime: dto.suspendTime,
      wakeTime: dto.wakeTime,
      days,
    });
    await this.runner.writeDesired(desired);
    const result = await this.runner.apply();

    if (!result.ok) {
      const msg = (result.stderr || result.stdout || `exit ${result.code}`).trim();
      row.lastApplyError = msg;
      await this.schedRepo.save(row);
      this.logger.error(`pmy-power-apply falló: ${msg}`);
      throw new InternalServerErrorException(`No se pudo aplicar el horario al servidor: ${msg}`);
    }

    row.lastApplyError = null;
    row.lastAppliedAt = new Date();
    await this.schedRepo.save(row);

    return this.get();
  }

  async notify(event: 'suspend' | 'wake'): Promise<void> {
    const row = await this.getRow();
    const recipients = row.recipients ?? [];
    if (!recipients.length) {
      this.logger.warn(`notify(${event}) sin destinatarios; no se envía correo`);
      return;
    }
    const host = os.hostname();
    const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' });
    const isSuspend = event === 'suspend';
    const subject = isSuspend
      ? `🌙 Servidor ${host} se está suspendiendo`
      : `☀️ Servidor ${host} despertó`;
    const htmlContent = isSuspend
      ? `<p>El servidor <b>${host}</b> se va a suspender.</p><p>Hora: ${now}</p><p>Despertará automáticamente a las <b>${row.wakeTime}</b>.</p>`
      : `<p>El servidor <b>${host}</b> despertó y está en línea.</p><p>Hora: ${now}</p>`;
    await this.mail.sendEmailNotification({ to: recipients, subject, htmlContent });
  }

  async sendTestEmail(): Promise<void> {
    const row = await this.getRow();
    const recipients = row.recipients ?? [];
    if (!recipients.length) {
      throw new InternalServerErrorException('No hay destinatarios configurados');
    }
    await this.mail.sendEmailNotification({
      to: recipients,
      subject: `✅ Prueba de alerta de energía — ${os.hostname()}`,
      htmlContent: `<p>Correo de prueba de Configuración → Servidor. Si lo recibes, las alertas de suspensión/despertar funcionan.</p>`,
    });
  }
}
