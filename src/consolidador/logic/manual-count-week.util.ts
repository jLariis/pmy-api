import { DiagnosisRow, Mark } from './manual-count.types';

/**
 * Revisión por SEMANA del "Conteo manual vs sistema": el usuario pega el conteo de toda la
 * semana sin decir de qué día es cada guía. Aquí se decide a qué día corresponde cada
 * marca, para luego diagnosticar ese día con la misma cadena de la revisión por día.
 */

/** Los 7 días (lunes–domingo) de la semana de `day`, como 'YYYY-MM-DD'. */
export function weekDaysOf(day: string): string[] {
  const d = new Date(`${day}T12:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=dom..6=sáb
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

/**
 * A qué día de la semana se asigna cada marca que contó el usuario, usando el diagnóstico
 * "sin conteo" de cada día. Prioridad (gana el día más reciente dentro de cada una):
 *   1) ese día debía cobrar esa marca (p. ej. DEX08 = justo el 3er día con 08);
 *   2) ese día se cobró esa marca;
 *   3) FedEx reporta esa marca ese día;
 *   4) el sistema tiene esa marca ese día;
 *   5) si nada coincide: el último día con movimiento de FedEx, o el lunes.
 * Si dos marcas caen el mismo día, gana la última caja (DEX08 sobre DEX07 sobre POD).
 */
export function assignWeekMarks(marks: Iterable<Mark>, byDay: { day: string; row: DiagnosisRow }[]): Map<string, Mark> {
  const latest = (pred: (r: DiagnosisRow) => boolean) => [...byDay].reverse().find((x) => pred(x.row))?.day ?? null;
  const out = new Map<string, Mark>();
  for (const m of marks) {
    const day =
      latest((r) => r.expected === m) ??
      latest((r) => r.charged.includes(m)) ??
      latest((r) => r.fedexSays === m) ??
      latest((r) => r.systemSays === m) ??
      latest((r) => r.fedexSays !== null) ??
      byDay[0]?.day;
    if (day) out.set(day, m);
  }
  return out;
}
