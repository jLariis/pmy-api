/**
 * REGLA CANÓNICA de "día local efectivo" de un ingreso — fuente ÚNICA de verdad para
 * que la tabla de ingresos (`getIncome`), el dashboard financiero
 * (`getFinantialDataForDashboard`) y los KPIs por sucursal (`getSubsidiariesKpis`)
 * clasifiquen cada ingreso EN EL MISMO DÍA y, por lo tanto, cuadren entre sí.
 *
 * El problema histórico: `income.date` NO es homogéneo entre orígenes:
 *   - `charge`: se guarda como el día operativo a MEDIANOCHE LOCAL (00:00Z). NO es un
 *     instante UTC real; ya viene "etiquetado" en el día correcto.
 *   - `tyco`/`aeropuerto`/`special_transfer`: se anclan a la medianoche de Hermosillo
 *     (07:00Z) al crearse (ver `hermosilloDayStartUtc`).
 *   - `shipment`/`collection`: es un instante UTC real del evento.
 *
 * Por eso el "día local" se calcula distinto por `sourceType`:
 *   - charge  → se toma `income.date` TAL CUAL (ya es medianoche local).
 *   - el resto → se resta el offset fijo de Hermosillo (UTC-7) al instante y se toma su día.
 *
 * Hermosillo no tiene horario de verano, así que el offset fijo de -7h es exacto.
 */

/** `sourceType` cuya fecha ya viene anclada al día local (no se le resta offset). */
export const CHARGE_SOURCE = 'charge';

/** Offset fijo de Hermosillo respecto a UTC (sin horario de verano). */
export const HERMOSILLO_OFFSET_HOURS = 7;

const HERMOSILLO_OFFSET_MS = HERMOSILLO_OFFSET_HOURS * 60 * 60 * 1000;

interface IncomeDateLike {
  sourceType?: string | null;
  date: Date | string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Instante "día local efectivo" de un ingreso (espejo del `toLocalInstant` de
 * `IncomeService.getIncome`): para `charge` es la fecha tal cual; para el resto es
 * `date − 7h` (lleva el instante UTC a la hora de pared de Hermosillo).
 */
export function effectiveLocalInstant(income: IncomeDateLike): Date {
  const d = income.date instanceof Date ? income.date : new Date(income.date);
  if (String(income.sourceType ?? '').toLowerCase() === CHARGE_SOURCE) return d;
  return new Date(d.getTime() - HERMOSILLO_OFFSET_MS);
}

/**
 * Día CALENDARIO local efectivo ('YYYY-MM-DD') de un ingreso. Es la parte de fecha (en
 * UTC) del instante efectivo: para charge = su día tal cual; para el resto = el día de
 * Hermosillo del evento.
 */
export function effectiveLocalDay(income: IncomeDateLike): string {
  const t = effectiveLocalInstant(income);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * Expresión SQL equivalente a `effectiveLocalDay`, para el agregado de KPIs (MySQL).
 * `income.date` se trata como instante UTC (igual que en JS): charge se toma tal cual y
 * el resto se corre -7h antes de extraer el día. Devuelve un `DATE` para comparar contra
 * los días 'YYYY-MM-DD' del rango.
 *
 * @param alias alias de la tabla income en el QueryBuilder (por defecto `income`).
 */
export function effectiveLocalDaySql(alias = 'income'): string {
  return `DATE(CASE WHEN ${alias}.sourceType = '${CHARGE_SOURCE}' THEN ${alias}.date ELSE ${alias}.date - INTERVAL ${HERMOSILLO_OFFSET_HOURS} HOUR END)`;
}

/**
 * Cotas UTC GENEROSAS (crudas) para prefiltrar por `income.date` y conservar el uso de
 * índice, sin perder filas en frontera. El filtro EXACTO lo hace la expresión de día
 * local (`effectiveLocalDaySql` en SQL, o `effectiveLocalDay` en memoria); estas cotas
 * solo acotan el escaneo:
 *   - inferior: 00:00Z del primer día (cubre las cargas del primer día, guardadas a 00:00Z).
 *   - superior: +7h del fin del último día (cubre envíos cerca de la medianoche local).
 *
 * @param startDay 'YYYY-MM-DD' primer día del rango (día local).
 * @param endDay   'YYYY-MM-DD' último día del rango (día local).
 */
export function rawUtcBounds(startDay: string, endDay: string): { rawStart: Date; rawEnd: Date } {
  const rawStart = new Date(`${startDay}T00:00:00.000Z`);
  const rawEnd = new Date(`${endDay}T23:59:59.999Z`);
  rawEnd.setTime(rawEnd.getTime() + HERMOSILLO_OFFSET_MS);
  return { rawStart, rawEnd };
}
