import { currentWeekRange, resolveDateRange, resolveDayRange } from './pagination.util';

describe('resolveDateRange (semana lun–dom, hora Hermosillo)', () => {
  it('from/to YYYY-MM-DD → 00:00 del lunes a 23:59:59.999 del domingo en Hermosillo', () => {
    const { start, end } = resolveDateRange('2026-09-28', '2026-10-04');
    expect(start.toISOString()).toBe('2026-09-28T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T06:59:59.999Z');
  });

  it('un mismo día cubre las 24 h locales', () => {
    const { start, end } = resolveDateRange('2026-10-01', '2026-10-01');
    expect(start.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-02T06:59:59.999Z');
  });

  it('sin from/to → semana en curso lun–dom (jueves 2026-10-01)', () => {
    const { start, end } = resolveDateRange(undefined, undefined, new Date('2026-10-01T20:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-28T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T06:59:59.999Z');
  });

  it('fechas inválidas → semana en curso', () => {
    const now = new Date('2026-10-01T20:00:00Z');
    expect(resolveDateRange('x', 'y', now)).toEqual(currentWeekRange(now));
  });
});

describe('currentWeekRange', () => {
  it('domingo por la noche en Hermosillo (ya lunes en UTC) sigue en su semana', () => {
    // 2026-10-04 22:00 Hermosillo = 2026-10-05T05:00Z
    const { start, end } = currentWeekRange(new Date('2026-10-05T05:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-28T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T06:59:59.999Z');
  });

  it('lunes 00:30 en Hermosillo arranca la nueva semana', () => {
    // 2026-10-05 00:30 Hermosillo = 2026-10-05T07:30Z
    const { start } = currentWeekRange(new Date('2026-10-05T07:30:00Z'));
    expect(start.toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });
});

describe('resolveDayRange (días calendario)', () => {
  it('pasa from/to YYYY-MM-DD tal cual', () => {
    expect(resolveDayRange('2026-09-28', '2026-10-04')).toEqual({ fromDay: '2026-09-28', toDay: '2026-10-04' });
  });

  it('sin from/to → lunes–domingo de la semana en curso (Hermosillo)', () => {
    expect(resolveDayRange(undefined, undefined, new Date('2026-10-01T20:00:00Z'))).toEqual({ fromDay: '2026-09-28', toDay: '2026-10-04' });
    // domingo 22:00 Hermosillo (lunes 05:00Z) sigue siendo su semana
    expect(resolveDayRange(undefined, undefined, new Date('2026-10-05T05:00:00Z'))).toEqual({ fromDay: '2026-09-28', toDay: '2026-10-04' });
  });
});
