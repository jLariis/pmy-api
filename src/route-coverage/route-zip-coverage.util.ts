import { cleanZip } from '../inbox/zip-coverage.util';

/** Fila cruda del historial: guías de un CP que salieron en una ruta (peso ya repartido 1/n). */
export interface RouteZipRow {
  routeId: string;
  subsidiaryId: string;
  zip: string | null;
  city: string | null;
  /** Peso: 1 por guía si la salida llevó una sola ruta; 1/n si llevó n rutas. */
  weight: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

export interface RouteZipShare {
  routeId: string;
  subsidiaryId: string;
  zip: string;
  city: string | null;
  /** Guías (peso redondeado, mínimo 1 si hubo alguna). */
  shipmentCount: number;
  /** Proporción 0–1 de las guías de ese CP (en esa sucursal) que fueron a esta ruta. */
  share: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Agrupa el historial por (ruta, CP) y calcula qué parte de cada CP se lleva cada ruta
 * dentro de su sucursal. CPs inválidos ("N/A", vacíos) se descartan: Hermosillo hoy
 * no trae CP y por eso no genera filas.
 */
export function computeRouteZipShares(rows: RouteZipRow[]): RouteZipShare[] {
  type Acc = { routeId: string; subsidiaryId: string; zip: string; w: number; cities: Map<string, number>; first: Date | null; last: Date | null };
  const byPair = new Map<string, Acc>();
  const zipTotals = new Map<string, number>();

  for (const r of rows) {
    const zip = cleanZip(r.zip);
    if (!zip || !r.routeId || !r.subsidiaryId || !(r.weight > 0)) continue;
    const key = `${r.routeId}|${zip}`;
    const acc = byPair.get(key) ?? { routeId: r.routeId, subsidiaryId: r.subsidiaryId, zip, w: 0, cities: new Map(), first: null, last: null };
    acc.w += r.weight;
    const city = (r.city ?? '').trim();
    if (city) acc.cities.set(city, (acc.cities.get(city) ?? 0) + r.weight);
    acc.first = minDate(acc.first, r.firstSeen);
    acc.last = maxDate(acc.last, r.lastSeen);
    byPair.set(key, acc);
    const zKey = `${r.subsidiaryId}|${zip}`;
    zipTotals.set(zKey, (zipTotals.get(zKey) ?? 0) + r.weight);
  }

  return [...byPair.values()].map((a) => {
    const total = zipTotals.get(`${a.subsidiaryId}|${a.zip}`) ?? 0;
    const city = [...a.cities.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return {
      routeId: a.routeId,
      subsidiaryId: a.subsidiaryId,
      zip: a.zip,
      city,
      shipmentCount: Math.max(1, Math.round(a.w)),
      share: total > 0 ? Math.round((a.w / total) * 10000) / 10000 : 0,
      firstSeenAt: a.first,
      lastSeenAt: a.last,
    };
  });
}
