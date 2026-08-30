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
  /** Guias aun sin desenlace: pendiente + en_ruta + en_bodega (+ en_transito/recibido, 0 en este sistema). */
  guiasPendientesDeMov: number;
  countF2: number;
}

export interface SubsidiaryPackageStats {
  totalPackages: number;
  deliveredPackages: number;
  undeliveredPackages: number;
  byExceptionCode: { code07: number; code08: number; code03: number; unknown: number };
  /** En proceso: guias que aun se mueven (en ruta + en bodega + pendiente). */
  inProcessPackages: number;
  /** Residual para cuadrar contra el total declarado (devueltos, ocurre, faltante, etc.). */
  otherPackages: number;
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
    inProcessPackages: 0,
    otherPackages: 0,
    totalCharges: 0,
    consolidations: { ordinary: 0, air: 0, total: 0 },
  };
}

/** Agrupa consolidados por subsidiaryId. total = SUM(numberOfPackages) declarado;
 *  POD/DEX/En proceso = SUM de conteos reales; Otros = residual que cuadra contra
 *  el declarado: Total = POD + DEX + En proceso + Otros (Otros con clamp >= 0). */
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
    s.undeliveredPackages += dex03 + dex07 + dex08;
    s.inProcessPackages += num(r.guiasPendientesDeMov);
    s.totalCharges += num(r.countF2);

    const type = String(r.type || '').toLowerCase();
    if (type.includes('aereo')) s.consolidations.air += 1;
    else if (type.includes('ordinar')) s.consolidations.ordinary += 1;
    s.consolidations.total += 1;
  }

  // Otros = residual que garantiza el cuadre contra el total declarado.
  for (const s of map.values()) {
    s.otherPackages = Math.max(
      0,
      s.totalPackages - s.deliveredPackages - s.undeliveredPackages - s.inProcessPackages,
    );
  }
  return map;
}
