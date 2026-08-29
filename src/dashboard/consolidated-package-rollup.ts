/** Fila de entrada: un consolidado con su numberOfPackages declarado y el desglose
 *  real de sus guias ligadas (proviene de ConsolidatedService.findAll). */
export interface ConsolidatedRollupInput {
  subsidiaryId: string;
  type: string; // 'ordinario' | 'aereo' | 'carga'
  numberOfPackages: number | string | null;
  entregado: number;
  dex03: number;
  dex07: number;
  dex08: number;
  en_ruta: number;
  otros: number;
  countF2: number;
}

export interface SubsidiaryPackageStats {
  totalPackages: number;
  deliveredPackages: number;
  undeliveredPackages: number;
  byExceptionCode: { code07: number; code08: number; code03: number; unknown: number };
  inTransitPackages: number;
  totalCharges: number;
  consolidations: { ordinary: number; air: number; total: number };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function emptyPackageStats(): SubsidiaryPackageStats {
  return {
    totalPackages: 0,
    deliveredPackages: 0,
    undeliveredPackages: 0,
    byExceptionCode: { code07: 0, code08: 0, code03: 0, unknown: 0 },
    inTransitPackages: 0,
    totalCharges: 0,
    consolidations: { ordinary: 0, air: 0, total: 0 },
  };
}

/** Agrupa consolidados por subsidiaryId. total = SUM(numberOfPackages) declarado;
 *  desglose = SUM de los conteos reales de las guias ligadas. */
export function rollupConsolidatedPackageStats(
  rows: ConsolidatedRollupInput[],
): Map<string, SubsidiaryPackageStats> {
  const map = new Map<string, SubsidiaryPackageStats>();
  for (const r of rows) {
    if (!r?.subsidiaryId) continue;
    let s = map.get(r.subsidiaryId);
    if (!s) { s = emptyPackageStats(); map.set(r.subsidiaryId, s); }

    s.totalPackages += num(r.numberOfPackages);

    const dex03 = num(r.dex03), dex07 = num(r.dex07), dex08 = num(r.dex08);
    s.deliveredPackages += num(r.entregado);
    s.byExceptionCode.code07 += dex07;
    s.byExceptionCode.code08 += dex08;
    s.byExceptionCode.code03 += dex03;
    s.byExceptionCode.unknown += num(r.otros);
    s.undeliveredPackages += dex03 + dex07 + dex08;
    s.inTransitPackages += num(r.en_ruta);
    s.totalCharges += num(r.countF2);

    const type = String(r.type || '').toLowerCase();
    if (type.includes('aereo')) s.consolidations.air += 1;
    else if (type.includes('ordinar')) s.consolidations.ordinary += 1;
    s.consolidations.total += 1;
  }
  return map;
}
