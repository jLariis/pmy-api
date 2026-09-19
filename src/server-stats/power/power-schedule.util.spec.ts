import {
  isValidTime,
  normalizeDays,
  daysToOnCalendar,
  nextOccurrence,
  computeNextEvents,
  buildDesired,
} from './power-schedule.util';

describe('power-schedule.util', () => {
  it('valida HH:MM', () => {
    expect(isValidTime('21:30')).toBe(true);
    expect(isValidTime('06:00')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
    expect(isValidTime('21:60')).toBe(false);
  });

  it('normaliza días: únicos, ordenados, rango 1..7', () => {
    expect(normalizeDays([6, 1, 1, 3])).toEqual([1, 3, 6]);
    expect(() => normalizeDays([])).toThrow();
    expect(() => normalizeDays([0])).toThrow();
    expect(() => normalizeDays([8])).toThrow();
  });

  it('arma OnCalendar de systemd', () => {
    expect(daysToOnCalendar([1, 2, 3, 4, 5, 6], '21:30')).toBe(
      'Mon,Tue,Wed,Thu,Fri,Sat *-*-* 21:30:00',
    );
    expect(daysToOnCalendar([7], '06:00')).toBe('Sun *-*-* 06:00:00');
  });

  it('nextOccurrence encuentra el próximo día activo a esa hora (TZ=UTC en tests)', () => {
    // 2026-09-18 es viernes (ISO 5). 08:00.
    const now = new Date('2026-09-18T08:00:00.000Z');
    // suspender viernes 21:30 -> mismo día
    expect(nextOccurrence(now, [1, 2, 3, 4, 5, 6], '21:30')?.toISOString()).toBe(
      '2026-09-18T21:30:00.000Z',
    );
    // si hoy (vie) no está activo, salta al lunes
    expect(nextOccurrence(now, [1], '21:30')?.toISOString()).toBe(
      '2026-09-21T21:30:00.000Z',
    );
  });

  it('computeNextEvents: wake es la mañana siguiente al próximo suspend', () => {
    const now = new Date('2026-09-18T08:00:00.000Z');
    const { nextSuspend, nextWake } = computeNextEvents(
      now,
      [1, 2, 3, 4, 5, 6],
      '21:30',
      '06:00',
      true,
    );
    expect(nextSuspend?.toISOString()).toBe('2026-09-18T21:30:00.000Z');
    expect(nextWake?.toISOString()).toBe('2026-09-19T06:00:00.000Z');
  });

  it('computeNextEvents: deshabilitado => null', () => {
    const now = new Date('2026-09-18T08:00:00.000Z');
    expect(computeNextEvents(now, [1], '21:30', '06:00', false)).toEqual({
      nextSuspend: null,
      nextWake: null,
    });
  });

  it('buildDesired normaliza días', () => {
    expect(
      buildDesired({ enabled: true, suspendTime: '21:30', wakeTime: '06:00', days: [6, 1, 1] }),
    ).toEqual({ enabled: true, suspendTime: '21:30', wakeTime: '06:00', days: [1, 6] });
  });
});
