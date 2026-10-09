/**
 * Fecha y hora en texto para los mensajes (WhatsApp, campana, correo), SIEMPRE en hora de
 * Hermosillo: UTC−7 fijo (Sonora no cambia de horario). Se arma a mano, sin `toLocaleString`, para
 * que no dependa de la zona ni del idioma del servidor.
 *   hermosilloDateTimeText(d) → "07 de Octubre a las 12:39 p.m."
 *   hermosilloTimeText(d)     → "12:39 p.m."
 */

const OFFSET_MS = 7 * 3_600_000;
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function parts(d: Date) {
  const h = new Date(d.getTime() - OFFSET_MS);
  return { day: h.getUTCDate(), month: h.getUTCMonth(), hour: h.getUTCHours(), minute: h.getUTCMinutes() };
}

export function hermosilloTimeText(d: Date): string {
  const p = parts(d);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'a.m.' : 'p.m.'}`;
}

export function hermosilloDateTimeText(d: Date): string {
  const p = parts(d);
  return `${String(p.day).padStart(2, '0')} de ${MONTHS[p.month]} a las ${hermosilloTimeText(d)}`;
}
