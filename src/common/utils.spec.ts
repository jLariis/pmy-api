import { toHermosilloDateString } from './utils';

describe('toHermosilloDateString', () => {
  it('takes the wall-clock day from a date-only string', () => {
    expect(toHermosilloDateString('2026-07-06')).toBe('2026-07-06');
  });

  it('takes the wall-clock day from an ISO string regardless of offset (Central midnight => 06:00Z)', () => {
    // This is exactly how legacy date-only expenses arrive from the front.
    expect(toHermosilloDateString('2026-07-06T06:00:00.000Z')).toBe('2026-07-06');
    expect(toHermosilloDateString('2026-07-06T00:00:00.000-06:00')).toBe('2026-07-06');
  });

  it('converts a real Date instant to its Hermosillo calendar day', () => {
    // 2026-07-06 03:00Z => Hermosillo 2026-07-05 20:00 => day 2026-07-05
    expect(toHermosilloDateString(new Date('2026-07-06T03:00:00.000Z'))).toBe('2026-07-05');
    // 2026-07-06 13:00Z => Hermosillo 2026-07-06 06:00 => day 2026-07-06
    expect(toHermosilloDateString(new Date('2026-07-06T13:00:00.000Z'))).toBe('2026-07-06');
  });
});
