import * as dayjs from 'dayjs';
import * as isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

/**
 * Regla de cobro DEX08 ("3ra visita / cliente no disponible").
 *
 * Un cobro 08 SOLO es válido cuando **3 eventos 08 caen en la MISMA semana ISO
 * (lunes–domingo)**. Antes se acumulaban los 08 de forma corrida entre semanas (o
 * incluso de ciclos anteriores de una guía reciclada), así que un paquete con 08
 * repartidos en 2 semanas llegaba a "3 acumulado" y cobraba sin haber tenido 3
 * visitas en una sola semana. Aquí el conteo es POR SEMANA.
 */

/** Clave de semana ISO (lun–dom), robusta en la frontera de año. */
export function isoWeekKey(d: Date): string {
  const m = dayjs(d);
  return `${m.isoWeekYear()}-W${m.isoWeek()}`;
}

/**
 * Dado los timestamps de los 08 YA persistidos y la lista de 08 NUEVOS, devuelve
 * los índices (dentro de `new08Dates`) de los eventos que COMPLETAN el 3er 08 de su
 * semana ISO (el que dispara el cobro). A lo sumo uno por semana: 08 posteriores de
 * la misma semana no re-disparan (el 4º, 5º… ya no cuentan), y semanas que ya tenían
 * ≥3 de historial tampoco (ya se cobró en una corrida previa).
 *
 * El conteo se hace en orden cronológico para que el "3ro" sea el correcto; los
 * índices devueltos apuntan al arreglo ORIGINAL sin reordenar.
 */
export function weeklyDex08ChargeIndexes(existing08Dates: Date[], new08Dates: Date[]): number[] {
  const week08 = new Map<string, number>();
  for (const d of existing08Dates) {
    const k = isoWeekKey(d);
    week08.set(k, (week08.get(k) ?? 0) + 1);
  }

  const chronological = new08Dates
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  const out: number[] = [];
  for (const { d, i } of chronological) {
    const k = isoWeekKey(d);
    const c = (week08.get(k) ?? 0) + 1;
    week08.set(k, c);
    if (c === 3) out.push(i); // exactamente al 3ro de la semana
  }
  return out;
}
