import { isSundayOrMexHoliday } from './sunday-holiday.util';

// Los tests corren en TZ=UTC (jest globalSetup). El util ancla SIEMPRE a Hermosillo
// (UTC-7), así que usamos instantes a mediodía UTC para caer en el mismo día calendario.
const at = (isoDay: string) => new Date(`${isoDay}T12:00:00.000Z`);

describe('isSundayOrMexHoliday', () => {
  it('domingo cuenta (2026-08-16 es domingo en Hermosillo)', () => {
    expect(isSundayOrMexHoliday(at('2026-08-16'))).toBe(true);
  });

  it('un miércoles normal NO cuenta (2026-08-19)', () => {
    expect(isSundayOrMexHoliday(at('2026-08-19'))).toBe(false);
  });

  it.each([
    ['Año Nuevo', '2026-01-01'],
    ['Día del Trabajo', '2026-05-01'],
    ['Independencia', '2026-09-16'],
    ['Navidad', '2026-12-25'],
  ])('feriado fijo: %s (%s)', (_label, day) => {
    expect(isSundayOrMexHoliday(at(day))).toBe(true);
  });

  it('1er lunes de febrero — Constitución (2026-02-02)', () => {
    expect(isSundayOrMexHoliday(at('2026-02-02'))).toBe(true);
  });

  it('3er lunes de marzo — Benito Juárez (2026-03-16)', () => {
    expect(isSundayOrMexHoliday(at('2026-03-16'))).toBe(true);
  });

  it('3er lunes de noviembre — Revolución (2026-11-16)', () => {
    expect(isSundayOrMexHoliday(at('2026-11-16'))).toBe(true);
  });

  it('un lunes que NO es feriado no cuenta (2026-02-09, 2º lunes feb)', () => {
    expect(isSundayOrMexHoliday(at('2026-02-09'))).toBe(false);
  });

  it('respeta el día de Hermosillo: instante que en UTC ya es domingo pero en Hermosillo es sábado NO cuenta', () => {
    // 2026-08-16T05:00Z => Hermosillo 2026-08-15 22:00 (sábado) => false
    expect(isSundayOrMexHoliday(new Date('2026-08-16T05:00:00.000Z'))).toBe(false);
  });

  it('acepta string ISO', () => {
    expect(isSundayOrMexHoliday('2026-05-01T12:00:00.000Z')).toBe(true);
  });

  describe('festivos adicionales del usuario', () => {
    it('festivo extra de FECHA EXACTA cuenta solo ese día', () => {
      const extra = [{ date: '2026-08-25', recurring: false }];
      expect(isSundayOrMexHoliday(at('2026-08-25'), extra)).toBe(true); // martes normal, pero festivo extra
      expect(isSundayOrMexHoliday(at('2026-08-26'), extra)).toBe(false);
      expect(isSundayOrMexHoliday(at('2027-08-25'), extra)).toBe(false); // otro año: no aplica (no recurrente)
    });

    it('festivo extra RECURRENTE cuenta el mismo mes-día cada año', () => {
      const extra = [{ date: '2026-06-10', recurring: true }];
      expect(isSundayOrMexHoliday(at('2026-06-10'), extra)).toBe(true);
      expect(isSundayOrMexHoliday(at('2027-06-10'), extra)).toBe(true); // otro año: sí aplica
      expect(isSundayOrMexHoliday(at('2026-06-11'), extra)).toBe(false);
    });

    it('los extra COMPLEMENTAN la lista fija (no la rompen)', () => {
      const extra = [{ date: '2026-08-25', recurring: false }];
      expect(isSundayOrMexHoliday(at('2026-01-01'), extra)).toBe(true); // fijo sigue contando
      expect(isSundayOrMexHoliday(at('2026-08-16'), extra)).toBe(true); // domingo sigue contando
    });

    it('sin extra se comporta igual que antes', () => {
      expect(isSundayOrMexHoliday(at('2026-08-25'))).toBe(false);
    });
  });
});
