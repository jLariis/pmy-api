import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerPowerService } from './server-power.service';
import { ServerPowerSchedule } from '../../entities/server-power-schedule.entity';
import { ServerPowerDay } from '../../entities/server-power-day.entity';
import { PowerApplyRunner } from './power-apply.runner';
import { MailService } from '../../mail/mail.service';
import { ConfigService } from '@nestjs/config';

function makeSchedRepo(row: any) {
  return {
    findOne: jest.fn().mockResolvedValue(row),
    save: jest.fn().mockImplementation(async (r) => ({ ...row, ...r })),
    create: jest.fn().mockImplementation((r) => r),
  };
}
function makeDayRepo(rows: any[]) {
  return {
    find: jest.fn().mockResolvedValue(rows),
    save: jest.fn().mockImplementation(async (r) => r),
  };
}

const baseRow = {
  id: 'sched-1',
  enabled: true,
  suspendTime: '21:30',
  wakeTime: '06:00',
  recipients: ['a@x.com'],
  lastAppliedAt: null,
  lastApplyError: null,
};
const baseDays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ id: `d${d}`, dayOfWeek: d, active: d <= 6 }));

async function build(overrides: {
  sched?: any;
  days?: any[];
  runner?: Partial<PowerApplyRunner>;
  mail?: Partial<MailService>;
}) {
  const runner = {
    writeDesired: jest.fn().mockResolvedValue(undefined),
    apply: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '', code: 0 }),
    isTimerActive: jest.fn().mockResolvedValue(true),
    ...(overrides.runner || {}),
  };
  const mail = {
    sendEmailNotification: jest.fn().mockResolvedValue(undefined),
    ...(overrides.mail || {}),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ServerPowerService,
      {
        provide: getRepositoryToken(ServerPowerSchedule),
        useValue: makeSchedRepo(structuredClone(overrides.sched ?? baseRow)),
      },
      {
        provide: getRepositoryToken(ServerPowerDay),
        useValue: makeDayRepo(structuredClone(overrides.days ?? baseDays)),
      },
      { provide: PowerApplyRunner, useValue: runner },
      { provide: MailService, useValue: mail },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  }).compile();
  return { svc: moduleRef.get(ServerPowerService), runner, mail };
}

describe('ServerPowerService', () => {
  it('get() devuelve la config con días activos y status', async () => {
    const { svc } = await build({});
    const view = await svc.get();
    expect(view.suspendTime).toBe('21:30');
    expect(view.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(view.recipients).toEqual(['a@x.com']);
    expect(view.status.timerActive).toBe(true);
  });

  it('update() persiste, escribe desired y aplica (ok)', async () => {
    const { svc, runner } = await build({});
    const view = await svc.update(
      { enabled: true, suspendTime: '22:00', wakeTime: '06:30', days: [1, 3, 5], recipients: ['b@x.com'] },
      'user-9',
    );
    expect(runner.writeDesired).toHaveBeenCalledWith(
      expect.objectContaining({ suspendTime: '22:00', wakeTime: '06:30', days: [1, 3, 5], enabled: true }),
    );
    expect(runner.apply).toHaveBeenCalled();
    expect(view.status.lastApplyError).toBeNull();
  });

  it('update() propaga error de apply (guarda lastApplyError y lanza)', async () => {
    const { svc } = await build({
      runner: { apply: jest.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'boom', code: 1 }) },
    });
    await expect(
      svc.update(
        { enabled: true, suspendTime: '22:00', wakeTime: '06:30', days: [1], recipients: ['b@x.com'] },
        'user-9',
      ),
    ).rejects.toThrow(/boom/);
  });

  it('notify() manda correo a los recipients de BD', async () => {
    const { svc, mail } = await build({});
    await svc.notify('suspend');
    expect(mail.sendEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@x.com'] }),
    );
  });
});
