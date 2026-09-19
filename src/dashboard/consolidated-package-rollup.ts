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

// ============================================================================
// Conteo OPERATIVO (con traspasos entre sucursales)
// ============================================================================

/** Consolidado con su DUEÑO (sucursal a la que se subió) y su total declarado. */
export interface OperationalConsolidatedRow {
  id: string;
  ownerId: string;
  numberOfPackages: number | string | null;
  type: string; // 'ordinario' | 'aereo' | 'carga'
}

/** Conteo de guías agrupado por (dueño del consolidado, sucursal OPERATIVA actual). */
export interface OperationalGroupRow {
  ownerId: string;
  /** Sucursal operativa = shipment.subsidiaryId (o el dueño si la guía no tiene sucursal). */
  opSub: string;
  total: number | string;
  entregado: number | string;
  dex03: number | string;
  dex07: number | string;
  dex08: number | string;
  /** Aún sin desenlace: pendiente + en_ruta + en_bodega. */
  pendienteMov: number | string;
}

/**
 * Rollup OPERATIVO: reparte los conteos considerando los traspasos entre sucursales.
 *
 * - `totalPackages`: base = SUM(numberOfPackages) DECLARADO por DUEÑO; luego se AJUSTA por
 *   traspaso: cada guía cuya sucursal operativa ≠ dueño sale del dueño y entra al destino.
 * - `deliveredPackages` / DEX / `inProcessPackages` / `totalCharges`: SIEMPRE por sucursal
 *   OPERATIVA (donde físicamente está la guía), sumando shipment + charge.
 * - `consolidations` (ordinario/aéreo/total): por DUEÑO (el consolidado no se mueve).
 *
 * Así, p. ej., paquetes traspasados de Bodega Hermosillo a Caborca cuentan en Caborca,
 * pero el consolidado sigue perteneciendo a Bodega Hermosillo.
 */
export function rollupOperationalPackageStats(
  consolidados: OperationalConsolidatedRow[],
  shipmentGroups: OperationalGroupRow[],
  chargeGroups: OperationalGroupRow[],
): Map<string, SubsidiaryPackageStats> {
  const map = new Map<string, SubsidiaryPackageStats>();
  const ensure = (id: string): SubsidiaryPackageStats => {
    let s = map.get(id);
    if (!s) { s = emptyPackageStats(); map.set(id, s); }
    return s;
  };

  // 1) Base declarada + consolidations por DUEÑO.
  for (const c of consolidados) {
    if (!c?.ownerId) continue;
    const s = ensure(c.ownerId);
    s.totalPackages += num(c.numberOfPackages);
    const type = String(c.type || '').toLowerCase();
    if (type.includes('aereo')) s.consolidations.air += 1;
    else if (type.includes('ordinar')) s.consolidations.ordinary += 1;
    s.consolidations.total += 1;
  }

  // 2) Desglose (POD/DEX/en proceso) por sucursal OPERATIVA (shipment + charge).
  for (const g of [...shipmentGroups, ...chargeGroups]) {
    if (!g?.opSub) continue;
    const s = ensure(g.opSub);
    const dex03 = num(g.dex03), dex07 = num(g.dex07), dex08 = num(g.dex08);
    s.deliveredPackages += num(g.entregado);
    s.byExceptionCode.code07 += dex07;
    s.byExceptionCode.code08 += dex08;
    s.byExceptionCode.code03 += dex03;
    s.undeliveredPackages += dex03 + dex07 + dex08;
    s.inProcessPackages += num(g.pendienteMov);
  }

  // 3) Cargas (F2) por sucursal OPERATIVA.
  for (const g of chargeGroups) {
    if (!g?.opSub) continue;
    ensure(g.opSub).totalCharges += num(g.total);
  }

  // 4) Ajuste de traspaso al TOTAL (guías normales): las que cambiaron de sucursal salen
  //    del dueño y entran a la operativa. Conserva el gran total declarado.
  for (const g of shipmentGroups) {
    if (!g?.opSub || !g?.ownerId || g.opSub === g.ownerId) continue;
    const moved = num(g.total);
    if (moved <= 0) continue;
    ensure(g.ownerId).totalPackages -= moved;
    ensure(g.opSub).totalPackages += moved;
  }

  // 5) Otros = residual que cuadra contra el total.
  for (const s of map.values()) {
    if (s.totalPackages < 0) s.totalPackages = 0; // salvaguarda si declarado < traspasos
    s.otherPackages = Math.max(
      0,
      s.totalPackages - s.deliveredPackages - s.undeliveredPackages - s.inProcessPackages,
    );
  }
  return map;
}
