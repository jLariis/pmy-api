import { weekRange } from './week.util';

describe('weekRange (lunes → domingo)', () => {
  it('miércoles cae en su semana lun–dom', () => {
    const { start, end } = weekRange(new Date('2026-08-19T15:00:00')); // miércoles
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7); // agosto
    expect(start.getDate()).toBe(17); // lunes
    expect(end.getDate()).toBe(23); // domingo
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
  });

  it('lunes es el inicio', () => {
    const { start } = weekRange(new Date('2026-08-17T09:00:00'));
    expect(start.getDate()).toBe(17);
  });

  it('domingo pertenece a la MISMA semana (no la siguiente)', () => {
    const { start, end } = weekRange(new Date('2026-08-23T20:00:00')); // domingo
    expect(start.getDate()).toBe(17); // lunes de esa semana
    expect(end.getDate()).toBe(23);
  });

  it('lunes y domingo de la misma semana dan el mismo rango', () => {
    const a = weekRange(new Date('2026-08-17T00:30:00'));
    const b = weekRange(new Date('2026-08-23T23:00:00'));
    expect(a.start.getTime()).toBe(b.start.getTime());
    expect(a.end.getTime()).toBe(b.end.getTime());
  });
});
