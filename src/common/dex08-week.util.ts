import * as dayjs from 'dayjs';
import * as isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

/**
 * Regla de cobro DEX08 ("3ra visita / cliente no disponible").
 *
 * Un cobro 08 SOLO es válido cuando hay **3 DÍAS distintos con 08 dentro de la MISMA
 * semana ISO (lunes–domingo)**. Dos matices que antes provocaban cobros falsos:
 *  1. POR SEMANA: antes se acumulaban los 08 de forma corrida entre semanas (o de ciclos
 *     anteriores de una guía reciclada), así que 08 repartidos en 2 semanas llegaban a
 *     "3 acumulado" y cobraban sin 3 visitas en una sola semana.
 *  2. POR DÍA distinto: una "3ra visita" son 3 INTENTOS, y nunca hay 2 intentos el mismo
 *     día. FedEx puede devolver el mismo 08 repetido, y un mismo 08 puede quedar guardado
 *     varias veces (re-arribos con timestamp distinto). Si se contaran esas LÍNEAS, una
 *     sola visita real inflaba el conteo a 3 y cobraba ("cobra con 1 solo 08"). Por eso
 *     aquí se cuentan DÍAS calendario distintos, no eventos.
 */

/** Clave de semana ISO (lun–dom), robusta en la frontera de año. */
export function isoWeekKey(d: Date): string {
  const m = dayjs(d);
  return `${m.isoWeekYear()}-W${m.isoWeek()}`;
}

/** Día calendario de un 08 (misma base de reloj que `isoWeekKey`, para que semana y día
 * no se contradigan en la frontera). */
export function dex08DayKey(d: Date): string {
  return dayjs(d).format('YYYY-MM-DD');
}

/**
 * Dado los timestamps de los 08 YA persistidos y la lista de 08 NUEVOS, devuelve
 * los índices (dentro de `new08Dates`) de los eventos que COMPLETAN el 3er DÍA distinto
 * con 08 de su semana ISO (el que dispara el cobro). Reglas:
 *  - Se cuentan DÍAS calendario distintos, no eventos: varios 08 del MISMO día (re-escaneos
 *    o re-arribos del mismo intento) cuentan como UNO.
 *  - A lo sumo uno por semana: eventos posteriores de la misma semana no re-disparan, y
 *    semanas que ya tenían ≥3 días de historial tampoco (ya se cobró en una corrida previa).
 *
 * El conteo se hace en orden cronológico para que el "3er día" sea el correcto; los
 * índices devueltos apuntan al arreglo ORIGINAL sin reordenar.
 */
export function weeklyDex08ChargeIndexes(existing08Dates: Date[], new08Dates: Date[]): number[] {
  // Por semana ISO, el conjunto de DÍAS distintos con 08 ya vistos.
  const weekDays = new Map<string, Set<string>>();
  const seenDay = (d: Date): { week: string; day: string; set: Set<string> } => {
    const week = isoWeekKey(d);
    let set = weekDays.get(week);
    if (!set) { set = new Set(); weekDays.set(week, set); }
    return { week, day: dex08DayKey(d), set };
  };
  for (const d of existing08Dates) {
    const { day, set } = seenDay(d);
    set.add(day);
  }

  const chronological = new08Dates
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  const out: number[] = [];
  for (const { d, i } of chronological) {
    const { day, set } = seenDay(d);
    if (set.has(day)) continue; // día ya contado → no suma ni re-dispara
    set.add(day);
    if (set.size === 3) out.push(i); // exactamente al 3er DÍA distinto de la semana
  }
  return out;
}

/**
 * ¿Hay alguna semana ISO con ≥3 DÍAS distintos con 08? Es la regla completa de cobro
 * DEX08 cuando no hay historial "ya cobrado" que distinguir (p. ej. el cierre de ruta, que
 * solo crea el ingreso si la guía aún no tiene uno).
 */
export function hasWeekWithThreeDex08Days(dex08Dates: Date[]): boolean {
  return weeklyDex08ChargeIndexes([], dex08Dates).length > 0;
}
