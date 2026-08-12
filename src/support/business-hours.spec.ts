import { DateTime } from 'luxon';
import { addBusinessHours, DEFAULT_BUSINESS_HOURS } from './business-hours';

const ZONE = 'America/Mexico_City';

/** Helper: construye un instante en la zona MX. */
function mx(y: number, m: number, d: number, h: number, min = 0): Date {
  return DateTime.fromObject({ year: y, month: m, day: d, hour: h, minute: min }, { zone: ZONE }).toJSDate();
}
/** Helper: compara un Date contra un instante esperado en la zona MX. */
function expectMx(actual: Date, y: number, m: number, d: number, h: number, min = 0) {
  const a = DateTime.fromJSDate(actual).setZone(ZONE);
  expect([a.year, a.month, a.day, a.hour, a.minute]).toEqual([y, m, d, h, min]);
}

describe('addBusinessHours (L–V 9–18, America/Mexico_City)', () => {
  const cfg = DEFAULT_BUSINESS_HOURS;

  it('suma dentro del mismo día laboral', () => {
    // Lunes 2026-08-10 10:00 + 3h = 13:00
    expectMx(addBusinessHours(mx(2026, 8, 10, 10), 3, cfg), 2026, 8, 10, 13);
  });

  it('cruza el cierre al día siguiente', () => {
    // Lunes 16:00 + 4h → 2h lunes (a 18:00) + 2h martes (9→11) = martes 11:00
    expectMx(addBusinessHours(mx(2026, 8, 10, 16), 4, cfg), 2026, 8, 11, 11);
  });

  it('antes de abrir arranca en la apertura', () => {
    // Lunes 07:00 + 1h → 9:00 + 1h = 10:00
    expectMx(addBusinessHours(mx(2026, 8, 10, 7), 1, cfg), 2026, 8, 10, 10);
  });

  it('después de cerrar salta al siguiente día', () => {
    // Lunes 19:00 + 1h → martes 9:00 + 1h = 10:00
    expectMx(addBusinessHours(mx(2026, 8, 10, 19), 1, cfg), 2026, 8, 11, 10);
  });

  it('salta el fin de semana', () => {
    // Viernes 2026-08-14 17:00 + 2h → 1h viernes (a 18:00) + 1h lunes (9→10) = lunes 17 10:00
    expectMx(addBusinessHours(mx(2026, 8, 14, 17), 2, cfg), 2026, 8, 17, 10);
  });

  it('un ticket de sábado no corre hasta el lunes', () => {
    // Sábado 2026-08-15 12:00 + 4h → lunes 9:00 + 4h = lunes 13:00
    expectMx(addBusinessHours(mx(2026, 8, 15, 12), 4, cfg), 2026, 8, 17, 13);
  });

  it('un día completo (9h) llega al cierre', () => {
    expectMx(addBusinessHours(mx(2026, 8, 10, 9), 9, cfg), 2026, 8, 10, 18);
  });

  it('18 horas hábiles = dos jornadas', () => {
    // Lunes 9:00 + 18h = martes 18:00
    expectMx(addBusinessHours(mx(2026, 8, 10, 9), 18, cfg), 2026, 8, 11, 18);
  });

  it('hours=0 devuelve el mismo instante', () => {
    const d = mx(2026, 8, 10, 10);
    expect(addBusinessHours(d, 0, cfg).getTime()).toBe(d.getTime());
  });
});
