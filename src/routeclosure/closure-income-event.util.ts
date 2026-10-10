import { toHermosilloDateString } from 'src/common/utils';

/** Fila mínima del historial (`shipment_status`) para fechar el ingreso del cierre. */
export interface IncomeHistoryRow {
  status: string | null;
  timestamp: Date | string | null;
  exceptionCode?: string | null;
  notes?: string | null;
}

export interface ClosureIncomeEventInput {
  history: IncomeHistoryRow[] | null | undefined;
  /** Estatus que cobra (el reconciliado del cierre: entregado, rechazado, devuelto…). */
  status: string | null | undefined;
  /** Código DEX esperado (07/08…); si alguna fila lo trae, solo esas cuentan. */
  exceptionCode?: string | null;
  /** Día de la ruta (YYYY-MM-DD Hermosillo): un evento anterior no es de esta ruta. */
  routeDay: string | null;
  /** Cuándo la guía salió en OTRA ruta (exclusivo): lo de después le toca a esa ruta. */
  windowEnd: Date | null;
}

export interface ClosureIncomeEvent {
  occurredAt: Date;
  exceptionCode: string | null;
}

/** Filas que escribimos nosotros (registro inicial, salida a ruta): no son eventos de FedEx. */
export function isInternalRow(row: IncomeHistoryRow): boolean {
  const code = (row.exceptionCode ?? '').trim().toUpperCase();
  if (code === 'INIT') return true;
  return /^salida a ruta/i.test((row.notes ?? '').trim());
}

/**
 * Regla de sucursal `closureIncomeAtFedexEventTime` (Loreto, 2026-10-10): el ingreso del cierre se
 * fecha con el `shipment_status.timestamp` del evento que lo genera, tal cual lo registró FedEx;
 * el sistema nunca lo cambia por el día de la ruta. Devuelve el evento MÁS RECIENTE con el estatus
 * cobrado dentro de la ventana [inicio del día de la ruta, siguiente salida); null si no hay
 * (sin evento no se cobra). Pura, sin I/O.
 */
export function selectClosureIncomeEvent(input: ClosureIncomeEventInput): ClosureIncomeEvent | null {
  const status = String(input.status ?? '').toLowerCase();
  if (!status) return null;
  const endMs = input.windowEnd ? input.windowEnd.getTime() : Infinity;

  const candidates: { at: Date; code: string }[] = [];
  for (const row of input.history ?? []) {
    if (!row?.timestamp || String(row.status ?? '').toLowerCase() !== status) continue;
    if (isInternalRow(row)) continue;
    const at = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
    if (isNaN(at.getTime())) continue;
    if (input.routeDay && toHermosilloDateString(at) < input.routeDay) continue;
    if (at.getTime() >= endMs) continue;
    candidates.push({ at, code: (row.exceptionCode ?? '').trim() });
  }

  const wanted = (input.exceptionCode ?? '').trim();
  const pool = wanted && candidates.some((c) => c.code === wanted)
    ? candidates.filter((c) => c.code === wanted)
    : candidates;
  if (!pool.length) return null;

  const latest = pool.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
  return { occurredAt: latest.at, exceptionCode: latest.code || null };
}
