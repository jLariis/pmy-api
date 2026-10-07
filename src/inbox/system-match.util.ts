/**
 * ¿Ya se subieron al sistema las guías de un archivo del correo? Se responde POR GUÍAS,
 * no por número de consolidado: hay sucursales (Hermosillo, rutas locales) que suben con
 * un número propio por ruta y día que el correo de FedEx nunca trae.
 */

export interface SystemHit {
  tracking: string;
  consNumber: string;
  subsidiaryId: string;
  subsidiaryName: string;
  at: Date; // cuándo se registró la guía
  byName: string | null;
  type: 'paquete' | 'carga';
}

export interface MatchGroup {
  consNumber: string;
  subsidiaryId: string;
  subsidiaryName: string;
  type: 'paquete' | 'carga';
  count: number;
  at: Date;
  byName: string | null;
}

export interface MatchSummary {
  total: number;
  found: number;
  /** Se considera subido cuando están al menos el 90 % de las guías. */
  complete: boolean;
  groups: MatchGroup[];
  bySubsidiary: { subsidiaryId: string; count: number }[];
}

export const MATCH_COMPLETE_RATIO = 0.9;

export function summarizeMatch(trackings: string[], hits: SystemHit[]): MatchSummary {
  const wanted = new Set(trackings);
  // Por guía, el registro más antiguo (una guía de "2a vuelta" puede aparecer otra vez después).
  const first = new Map<string, SystemHit>();
  for (const h of hits) {
    if (!wanted.has(h.tracking)) continue;
    const prev = first.get(h.tracking);
    if (!prev || h.at.getTime() < prev.at.getTime()) first.set(h.tracking, h);
  }
  const groups = new Map<string, MatchGroup>();
  for (const h of first.values()) {
    const key = `${h.type}|${h.subsidiaryId}|${h.consNumber}`;
    const g = groups.get(key) ?? { consNumber: h.consNumber, subsidiaryId: h.subsidiaryId, subsidiaryName: h.subsidiaryName, type: h.type, count: 0, at: h.at, byName: h.byName };
    g.count++;
    if (h.at.getTime() < g.at.getTime()) {
      g.at = h.at;
      g.byName = h.byName;
    }
    groups.set(key, g);
  }
  const bySub = new Map<string, number>();
  for (const h of first.values()) bySub.set(h.subsidiaryId, (bySub.get(h.subsidiaryId) ?? 0) + 1);
  const total = wanted.size;
  const found = first.size;
  return {
    total,
    found,
    complete: total > 0 && found / total >= MATCH_COMPLETE_RATIO,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    bySubsidiary: [...bySub.entries()].map(([subsidiaryId, count]) => ({ subsidiaryId, count })).sort((a, b) => b.count - a.count),
  };
}

/** Estado de subida del correo completo a partir de cada bloque. */
export function coverageOf(units: { total: number; found: number; complete: boolean }[]): 'ninguno' | 'parcial' | 'completo' | null {
  const real = units.filter((u) => u.total > 0);
  if (!real.length) return null;
  if (real.every((u) => u.complete)) return 'completo';
  if (real.some((u) => u.found > 0)) return 'parcial';
  return 'ninguno';
}
