/**
 * Utilidades de paginación y rango de fechas para listados (evita cargar todo
 * el histórico en memoria).
 */

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Normaliza page/limit (page 1-based) y calcula el offset. */
export function parsePagination(
  page?: string | number,
  limit?: string | number,
  defaultLimit = DEFAULT_LIMIT,
): { page: number; limit: number; skip: number } {
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const l = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(limit)) || defaultLimit));
  return { page: p, limit: l, skip: (p - 1) * l };
}

/** Lunes 00:00:00.000 a Domingo 23:59:59.999 de la semana actual (hora del servidor). */
export function currentWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay(); // 0=Dom .. 6=Sab
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Resuelve el rango de fechas a usar: si llegan `from`/`to` válidos se usan
 * (normalizando inicio/fin de día); si no, se usa la semana actual (lun-dom).
 */
export function resolveDateRange(from?: string, to?: string): { start: Date; end: Date } {
  if (from && to) {
    const start = new Date(from);
    const end = new Date(to);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }
  return currentWeekRange();
}
