import { hermosilloDayStartFromInstant, hermosilloDayStartUtc, toHermosilloDateString } from './utils';

describe('hermosilloDayStartFromInstant', () => {
  // Para un INSTANTE real (p.ej. la salida a ruta / dispatch.createdAt), el día se deriva
  // en zona Hermosillo (UTC-7) y se ancla a su medianoche (07:00Z). Distinto del helper de
  // "fecha flotante": aquí sí importa la hora del instante.
  it('tarde de Hermosillo => 07:00Z del mismo día', () => {
    // 2026-08-06 17:35Z = 10:35 Hmo => día 06
    expect(hermosilloDayStartFromInstant(new Date('2026-08-06T17:35:00Z')).toISOString())
      .toBe('2026-08-06T07:00:00.000Z');
  });
  it('noche de Hermosillo aunque en UTC ya sea el día siguiente => día Hmo correcto', () => {
    // 2026-08-07 02:00Z = 2026-08-06 19:00 Hmo => día 06 (NO 07)
    expect(hermosilloDayStartFromInstant(new Date('2026-08-07T02:00:00Z')).toISOString())
      .toBe('2026-08-06T07:00:00.000Z');
  });
  it('madrugada UTC = noche anterior en Hmo => día anterior', () => {
    // 2026-08-08 00:41Z = 2026-08-07 17:41 Hmo => día 07
    expect(hermosilloDayStartFromInstant(new Date('2026-08-08T00:41:00Z')).toISOString())
      .toBe('2026-08-07T07:00:00.000Z');
  });
});

describe('hermosilloDayStartUtc', () => {
  // Un "día flotante" (fecha sin hora que elige el usuario) llega como medianoche UTC.
  // Debe anclarse a medianoche de Hermosillo (UTC-7) = 07:00Z, NO reinterpretarse como
  // instante real (eso lo tiraría al día anterior). Este es el bug de los traslados.
  it('date-only string => 07:00Z del mismo día', () => {
    expect(hermosilloDayStartUtc('2026-07-15').toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('Date en medianoche UTC (como llega transferDate) => 07:00Z del MISMO día', () => {
    expect(hermosilloDayStartUtc(new Date('2026-07-15T00:00:00.000Z')).toISOString())
      .toBe('2026-07-15T07:00:00.000Z');
  });

  it('string con offset (día calendario UTC intacto) => 07:00Z del mismo día', () => {
    expect(hermosilloDayStartUtc('2026-07-15T00:00:00.000-07:00').toISOString())
      .toBe('2026-07-15T07:00:00.000Z');
  });
});

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
