/** Salida reciente de alguna de las rutas elegidas (más nueva primero). */
export interface RecentDispatch {
  dispatchId: string;
  createdAt: Date;
  driverIds: string[];
  vehicleId: string | null;
}

export interface DispatchDefaults {
  /** Repartidores sugeridos (los más frecuentes en las últimas salidas de esas rutas). */
  driverIds: string[];
  /** Unidad sugerida: la que más usó el repartidor sugerido en esas salidas; si no, la más usada. */
  vehicleId: string | null;
  /** En cuántas de las salidas revisadas aparece el repartidor sugerido. */
  driverHits: number;
  sample: number;
}

const MIN_SAMPLE = 2;

/**
 * Sugiere repartidor y unidad con las últimas `limit` salidas de las rutas elegidas. Solo se
 * sugiere algo que se repite (mínimo 2 veces); si no hay patrón, no se sugiere nada.
 */
export function pickDispatchDefaults(recent: RecentDispatch[], limit = 8): DispatchDefaults {
  const sample = [...recent].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  const driverCount = new Map<string, number>();
  const driverLast = new Map<string, number>();
  sample.forEach((d, i) => {
    for (const id of new Set(d.driverIds)) {
      driverCount.set(id, (driverCount.get(id) ?? 0) + 1);
      if (!driverLast.has(id)) driverLast.set(id, i);
    }
  });
  const ranked = [...driverCount.entries()].sort((a, b) => b[1] - a[1] || (driverLast.get(a[0]) ?? 0) - (driverLast.get(b[0]) ?? 0));
  const top = ranked[0];
  const driverIds = top && top[1] >= MIN_SAMPLE ? [top[0]] : [];

  const countVehicles = (rows: RecentDispatch[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.vehicleId) m.set(r.vehicleId, (m.get(r.vehicleId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const withDriver = driverIds.length ? sample.filter((d) => d.driverIds.includes(driverIds[0])) : [];
  const vTop = countVehicles(withDriver.length ? withDriver : sample);
  const vehicleId = vTop && vTop[1] >= MIN_SAMPLE ? vTop[0] : null;

  return { driverIds, vehicleId, driverHits: top && driverIds.length ? top[1] : 0, sample: sample.length };
}

/**
 * Último kilometraje creíble de una unidad: el mayor entre lo que tiene la unidad y lo capturado
 * en sus salidas recientes, ignorando capturas de relleno ("1", "00000", menos de 100 km).
 */
export function lastPlausibleKms(values: (string | number | null | undefined)[]): number | null {
  let best: number | null = null;
  for (const v of values) {
    const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n < 100) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}
