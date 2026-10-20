/** Un registro de la guía en alguna sucursal: paquete, carga, recolección o No VAN. */
export interface GuideCandidate {
  tn: string;
  subsidiaryId: string;
  kind: 'shipment' | 'charge' | 'novan' | 'collection';
  createdAt: string | Date;
  consDay: string | null; // día del consolidado/carga si aplica
}

/**
 * Conteo manual por zona: ubica cada guía pegada en UNA sucursal de la zona. Si aparece en
 * varias, gana el registro vigente ese día (el más reciente con fecha ≤ día; si todos son
 * posteriores, el más antiguo) — mismo criterio que `pickShipmentRowForDay`.
 */
export function locateGuides(
  tns: string[],
  candidates: GuideCandidate[],
  scopeIds: string[],
  day: string,
): { bySubsidiary: Map<string, string[]>; unlocated: string[] } {
  const scope = new Set(scopeIds);
  const effDay = (c: GuideCandidate) => c.consDay ?? new Date(c.createdAt).toISOString().slice(0, 10);
  const byTn = new Map<string, GuideCandidate[]>();
  for (const c of candidates) if (scope.has(c.subsidiaryId)) byTn.set(c.tn, [...(byTn.get(c.tn) ?? []), c]);

  const bySubsidiary = new Map<string, string[]>();
  const unlocated: string[] = [];
  for (const tn of [...new Set(tns)]) {
    const rows = byTn.get(tn);
    if (!rows?.length) {
      unlocated.push(tn);
      continue;
    }
    const current = rows.filter((r) => effDay(r) <= day).sort((a, b) => effDay(b).localeCompare(effDay(a)))[0];
    const pick = current ?? [...rows].sort((a, b) => effDay(a).localeCompare(effDay(b)))[0];
    bySubsidiary.set(pick.subsidiaryId, [...(bySubsidiary.get(pick.subsidiaryId) ?? []), tn]);
  }
  return { bySubsidiary, unlocated };
}
