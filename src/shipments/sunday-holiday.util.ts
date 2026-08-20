import { formatInTimeZone } from 'date-fns-tz';

/**
 * ¿La fecha cae en domingo o en un día festivo oficial de México?
 *
 * Se usa para el SOBREPRECIO de cobro de cargas F2 / 1.5 ton (ver `resolveChargeCost`).
 * El día se ancla SIEMPRE a la zona de Hermosillo (UTC-7, sin horario de verano), de modo
 * que un instante que en UTC ya cambió de día siga contando para el día correcto de la
 * operación (mismo criterio que el resto de fechas del sistema).
 *
 * Feriados = "días de descanso obligatorio" del Art. 74 de la Ley Federal del Trabajo:
 *  - 1 de enero (Año Nuevo)
 *  - 1er lunes de febrero (Día de la Constitución)
 *  - 3er lunes de marzo (Natalicio de Benito Juárez)
 *  - 1 de mayo (Día del Trabajo)
 *  - 16 de septiembre (Independencia)
 *  - 3er lunes de noviembre (Revolución Mexicana)
 *  - 25 de diciembre (Navidad)
 * (Se omite el 1 de octubre de transición sexenal por ser cada 6 años.)
 */
const TZ = 'America/Hermosillo';

/** Feriados de fecha fija, como 'MM-dd'. */
const FIXED_HOLIDAYS = new Set(['01-01', '05-01', '09-16', '12-25']);

export function isSundayOrMexHoliday(input: string | Date): boolean {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return false;

  // Día calendario en Hermosillo, p.ej. '2026-08-16'.
  const ymd = formatInTimeZone(d, TZ, 'yyyy-MM-dd');
  const [year, month, day] = ymd.split('-').map(Number);
  // getUTCDay sobre la medianoche UTC de ese día calendario: 0=Dom .. 6=Sáb.
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const md = ymd.slice(5); // 'MM-dd'

  if (dow === 0) return true; // domingo
  if (FIXED_HOLIDAYS.has(md)) return true;

  // Feriados de "n-ésimo lunes del mes" (día 1-7 => 1º, 8-14 => 2º, 15-21 => 3º...).
  if (dow === 1) {
    const nth = Math.ceil(day / 7);
    if (month === 2 && nth === 1) return true; // Constitución
    if (month === 3 && nth === 3) return true; // Benito Juárez
    if (month === 11 && nth === 3) return true; // Revolución
  }

  return false;
}
