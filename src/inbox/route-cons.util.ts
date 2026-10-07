/**
 * Rutas locales: sacar el número de ruta del nombre del archivo y el formato con el que
 * cada sucursal arma su número de consolidado propio.
 *   Hermosillo:        fecha+ruta → 071026364  (dd mm aa + ruta; 0710263642 = 2a vuelta)
 *   Bodega Hermosillo: ruta+fecha → 36405102026 (ruta + dd mm aaaa)
 */

export type RoutePattern = 'fecha+ruta' | 'ruta+fecha';

/** Número de ruta (3 dígitos) en el nombre del archivo: "364.xlsx", "RUTA 365 …", "CP367.xlsx". */
export function routeOf(filename: string): string | null {
  const base = (filename ?? '').replace(/\.[a-z0-9]+$/i, '').toUpperCase();
  const byWord = base.match(/RUTA\s*0*(\d{3})(?!\d)/);
  if (byWord) return byWord[1];
  const lead = base.match(/^(?:CP\s*)?(\d{3})(?!\d)/);
  return lead ? lead[1] : null;
}

const ddmmyy = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(2, 4)}`;
const ddmmyyyy = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}`;

/** ¿Este número sigue algún formato de ruta para ese día? (día = YYYY-MM-DD local) */
export function patternOf(consNumber: string, day: string): { pattern: RoutePattern; route: string } | null {
  const c = (consNumber ?? '').trim();
  if (/^\d{9,10}$/.test(c) && c.startsWith(ddmmyy(day))) return { pattern: 'fecha+ruta', route: c.slice(6, 9) };
  if (/^\d{11}$/.test(c) && c.endsWith(ddmmyyyy(day))) return { pattern: 'ruta+fecha', route: c.slice(0, 3) };
  return null;
}

/** El formato que más usa una sucursal en sus consolidados recientes (al menos 3 casos). */
export function detectRoutePattern(samples: { consNumber: string; day: string }[]): RoutePattern | null {
  const count: Record<RoutePattern, number> = { 'fecha+ruta': 0, 'ruta+fecha': 0 };
  for (const s of samples) {
    const p = patternOf(s.consNumber, s.day);
    if (p) count[p.pattern]++;
  }
  const best = (Object.entries(count) as [RoutePattern, number][]).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 3 ? best[0] : null;
}

export function buildConsNumber(pattern: RoutePattern, route: string, day: string): string {
  return pattern === 'fecha+ruta' ? `${ddmmyy(day)}${route}` : `${route}${ddmmyyyy(day)}`;
}

export interface RouteDay {
  route: string;
  day: string; // YYYY-MM-DD local
  total: number;
  found: number;
  complete: boolean;
  type: 'paquete' | 'carga' | null;
  subsidiaryName: string | null;
  consNumber: string | null;
}

export interface RouteSummary {
  route: string;
  daysReceived: number;
  daysUploaded: number;
  daysPartial: number;
  missingDays: string[];
  guides: number;
  asPackage: number; // días que se subió como paquete
  asCharge: number; // días que se subió como carga
  subsidiaries: { name: string; days: number }[];
  last: { day: string; consNumber: string | null; type: 'paquete' | 'carga' | null; subsidiaryName: string | null } | null;
}

/** Junta por ruta los días que llegó por correo contra lo que se subió (mejor resultado por día). */
export function summarizeRoutes(rows: RouteDay[]): RouteSummary[] {
  const best = new Map<string, RouteDay>();
  for (const r of rows) {
    const k = `${r.route}|${r.day}`;
    const prev = best.get(k);
    if (!prev || r.found / Math.max(1, r.total) > prev.found / Math.max(1, prev.total)) best.set(k, r);
  }
  const byRoute = new Map<string, RouteDay[]>();
  for (const r of best.values()) byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r]);
  return [...byRoute.entries()]
    .map(([route, days]) => {
      days.sort((a, b) => a.day.localeCompare(b.day));
      const subs = new Map<string, number>();
      for (const d of days) if (d.subsidiaryName && d.found > 0) subs.set(d.subsidiaryName, (subs.get(d.subsidiaryName) ?? 0) + 1);
      const lastUp = [...days].reverse().find((d) => d.found > 0) ?? null;
      return {
        route,
        daysReceived: days.length,
        daysUploaded: days.filter((d) => d.complete).length,
        daysPartial: days.filter((d) => !d.complete && d.found > 0).length,
        missingDays: days.filter((d) => d.found === 0).map((d) => d.day),
        guides: days.reduce((s, d) => s + d.total, 0),
        asPackage: days.filter((d) => d.found > 0 && d.type === 'paquete').length,
        asCharge: days.filter((d) => d.found > 0 && d.type === 'carga').length,
        subsidiaries: [...subs.entries()].map(([name, n]) => ({ name, days: n })).sort((a, b) => b.days - a.days),
        last: lastUp ? { day: lastUp.day, consNumber: lastUp.consNumber, type: lastUp.type, subsidiaryName: lastUp.subsidiaryName } : null,
      };
    })
    .sort((a, b) => b.missingDays.length - a.missingDays.length || a.route.localeCompare(b.route));
}
