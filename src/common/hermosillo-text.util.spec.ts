import { hermosilloDateTimeText, hermosilloTimeText } from './hermosillo-text.util';

describe('hermosillo-text', () => {
  it('fecha larga en hora de Hermosillo (UTC−7), sin importar la zona del servidor', () => {
    expect(hermosilloDateTimeText(new Date('2026-10-07T19:39:00.000Z'))).toBe('07 de Octubre a las 12:39 p.m.');
    // 02:10 UTC del día 9 = 19:10 del día 8 en Hermosillo
    expect(hermosilloDateTimeText(new Date('2026-10-09T02:10:00.000Z'))).toBe('08 de Octubre a las 7:10 p.m.');
  });

  it('mediodía, medianoche y mañana', () => {
    expect(hermosilloTimeText(new Date('2026-10-07T19:00:00.000Z'))).toBe('12:00 p.m.');
    expect(hermosilloTimeText(new Date('2026-10-08T07:05:00.000Z'))).toBe('12:05 a.m.');
    expect(hermosilloTimeText(new Date('2026-10-08T16:30:00.000Z'))).toBe('9:30 a.m.');
  });

  it('julio (en verano tampoco cambia: Sonora no tiene horario de verano)', () => {
    expect(hermosilloDateTimeText(new Date('2026-07-15T15:00:00.000Z'))).toBe('15 de Julio a las 8:00 a.m.');
  });
});
