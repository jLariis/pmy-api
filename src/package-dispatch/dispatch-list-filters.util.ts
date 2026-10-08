import { DispatchStatus } from 'src/common/enums/dispatch-enum';

/** Filtros del listado de salidas a ruta (del lado del servidor: la tabla pagina en el backend). */
export interface DispatchListFilters {
  statuses: DispatchStatus[];
  driverIds: string[];
  /** Días de ruta YYYY-MM-DD. */
  days: string[];
  /** null = sin filtro. */
  is315: boolean | null;
}

/** Acepta "a,b" o ["a","b"] (query string repetido) y regresa valores limpios sin duplicados. */
function list(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const out = raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(out)];
}

const VALID_STATUSES = new Set<string>(Object.values(DispatchStatus));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza los filtros del query. Valores inválidos se ignoran (no truenan el listado).
 * is315: una sola opción ("true"/"false") filtra; ambas o ninguna = sin filtro.
 */
export function parseDispatchListFilters(q: {
  status?: unknown;
  driverId?: unknown;
  day?: unknown;
  is315?: unknown;
}): DispatchListFilters {
  const flags = list(q.is315).filter((v) => v === 'true' || v === 'false');
  return {
    statuses: list(q.status).filter((s) => VALID_STATUSES.has(s)) as DispatchStatus[],
    driverIds: list(q.driverId).filter((d) => UUID_RE.test(d)),
    days: list(q.day).filter((d) => DAY_RE.test(d)),
    is315: flags.length === 1 ? flags[0] === 'true' : null,
  };
}
