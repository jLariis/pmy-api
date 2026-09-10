import { getWeekRangeMxLunDom } from './consolidador-week.util';

describe('getWeekRangeMxLunDom', () => {
  it('miércoles cae en su semana lun–dom', () => {
    const { from, to } = getWeekRangeMxLunDom(new Date('2026-09-09T12:00:00')); // mié
    expect(from.getDay()).toBe(1); // lunes
    expect(to.getDay()).toBe(0); // domingo
    expect(to.getTime() - from.getTime()).toBeGreaterThan(6 * 24 * 3600 * 1000);
  });

  it('domingo pertenece a la semana que termina ese domingo (no la siguiente)', () => {
    const { from, to } = getWeekRangeMxLunDom(new Date('2026-09-13T23:00:00')); // dom
    expect(from.getDate()).toBe(7); // lunes 7
    expect(to.getDate()).toBe(13); // domingo 13
  });
});
