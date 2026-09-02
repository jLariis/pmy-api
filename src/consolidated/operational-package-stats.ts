/**
 * Conteos del Dashboard por SUCURSAL OPERATIVA (quien opera la guia hoy:
 * `shipment.subsidiary` / `charge_shipment.subsidiary`), no por el dueño del
 * consolidado (la bodega). Resuelve el fan-out de bodegas: un consolidado de
 * bodega que se reparte a varias sucursales satelite ya no infla a la bodega;
 * cada guia cuenta para quien la opera. Ver spec 2026-09-01.
 *
 * Este modulo es PURO (sin DB) para poder probar el cuadre en unit tests. La
 * capa de SQL (ConsolidatedService.getOperationalCountsBySubsidiary) solo agrega
 * por subsidiaryId y delega el armado aqui.
 */

/** Agregado de estatus por sucursal operativa (una fila por subsidiaryId). */
export interface OperationalStatusAgg {
  subsidiaryId: string | null | undefined;
  /** COUNT de guias (shipment) de esa sucursal. */
  total: number | string | null;
  entregado: number | string | null;
  dex03: number | string | null;
  dex07: number | string | null;
  dex08: number | string | null;
  /** Guias aun en movimiento: pendiente + en_ruta + en_transito + en_bodega + recibido_en_bodega. */
  pendienteMov: number | string | null;
}

/**
 * Cargas F2 (charge_shipment) por sucursal operativa. Mismas columnas de estatus
 * que `OperationalStatusAgg`: las cargas se cuentan JUNTO con los shipments en el
 * total y el desglose (igual que el motor viejo `findAll`: total = shipments + F2),
 * y ademas `total` sirve como `totalCharges` (indicador aparte del # de cargas).
 */
export type OperationalChargeAgg = OperationalStatusAgg;

/** Un consolidado del periodo con su dueño (la bodega/sucursal que lo creo) y tipo. */
export interface ConsolidationOwnerRow {
  subsidiaryId: string | null | undefined;
  type: string | null | undefined; // 'ordinario' | 'aereo' | 'carga'
}

/**
 * Remanente DECLARADO aun sin distribuir de un consolidado: `numberOfPackages`
 * declarado menos las guias ya ligadas (shipment + charge_shipment). Se atribuye
 * al DUEÑO del consolidado (la bodega): son paquetes que llegaron y estan
 * fisicamente en la bodega, todavia sin escanear/repartir. Recupera la visibilidad
 * del intake del dia sin volver a inflar (conforme se escanean, el conteo se mueve
 * a las sucursales operativas y el remanente baja).
 */
export interface OwnerRemainderRow {
  subsidiaryId: string | null | undefined;
  remainder: number | string | null;
}

export interface SubsidiaryPackageStats {
  totalPackages: number;
  deliveredPackages: number;
  undeliveredPackages: number;
  byExceptionCode: { code07: number; code08: number; code03: number; unknown: number };
  /** En proceso: guias que aun se mueven (pendiente + en ruta + en bodega). */
  inProcessPackages: number;
  /** Residual para cuadrar contra el total real (devueltos, ocurre, a cargo de FedEx, etc.). */
  otherPackages: number;
  totalCharges: number;
  /** Se mantiene por DUEÑO del consolidado (actividad de la bodega). */
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

function ensure(map: Map<string, SubsidiaryPackageStats>, id: string): SubsidiaryPackageStats {
  let s = map.get(id);
  if (!s) { s = emptyPackageStats(); map.set(id, s); }
  return s;
}

/**
 * Arma el Map<subsidiaryId, SubsidiaryPackageStats> combinando tres fuentes:
 *  - shipmentAgg: paquetes (shipment) por sucursal OPERATIVA -> total + desglose de estatus.
 *  - chargeAgg:   cargas F2 (charge_shipment) por sucursal OPERATIVA -> totalCharges.
 *  - consolidationRows: consolidados del periodo por DUEÑO -> consolidations (ordinary/air/total).
 *
 * Cuadre por sucursal (solo paquetes/shipment):
 *   totalPackages = deliveredPackages + undeliveredPackages + inProcessPackages + otherPackages
 * (otherPackages clamp >= 0). Las cargas F2 son una via separada (totalCharges), no entran al cuadre.
 */
export function buildOperationalStats(input: {
  shipmentAgg: OperationalStatusAgg[];
  chargeAgg: OperationalChargeAgg[];
  consolidationRows: ConsolidationOwnerRow[];
  /** Remanente declarado sin distribuir, por dueño del consolidado. Opcional. */
  ownerRemainder?: OwnerRemainderRow[];
}): Map<string, SubsidiaryPackageStats> {
  const map = new Map<string, SubsidiaryPackageStats>();

  const foldStatus = (s: SubsidiaryPackageStats, r: OperationalStatusAgg) => {
    const dex03 = num(r.dex03), dex07 = num(r.dex07), dex08 = num(r.dex08);
    s.totalPackages += num(r.total);
    s.deliveredPackages += num(r.entregado);
    s.byExceptionCode.code03 += dex03;
    s.byExceptionCode.code07 += dex07;
    s.byExceptionCode.code08 += dex08;
    s.undeliveredPackages += dex03 + dex07 + dex08;
    s.inProcessPackages += num(r.pendienteMov);
  };

  // Shipments (guias normales) al total + desglose.
  for (const r of input.shipmentAgg) {
    if (!r?.subsidiaryId) continue;
    foldStatus(ensure(map, r.subsidiaryId), r);
  }

  // Cargas F2: cuentan JUNTO con los shipments en el total y el desglose (igual que el
  // motor viejo: total = shipments + F2), y ademas `total` alimenta `totalCharges`.
  for (const r of input.chargeAgg) {
    if (!r?.subsidiaryId) continue;
    const s = ensure(map, r.subsidiaryId);
    foldStatus(s, r);
    s.totalCharges += num(r.total);
  }

  for (const r of input.consolidationRows) {
    if (!r?.subsidiaryId) continue;
    const s = ensure(map, r.subsidiaryId);
    const type = String(r.type || '').toLowerCase();
    if (type.includes('aereo')) s.consolidations.air += 1;
    else if (type.includes('ordinar')) s.consolidations.ordinary += 1;
    s.consolidations.total += 1;
  }

  // Remanente declarado sin distribuir -> al DUEÑO (bodega), como "en proceso"
  // (llego, esta en la bodega, aun sin escanear/repartir). Suma a total y a en proceso
  // para que el cuadre se mantenga.
  for (const r of input.ownerRemainder ?? []) {
    if (!r?.subsidiaryId) continue;
    const rem = Math.max(0, num(r.remainder));
    if (rem === 0) continue;
    const s = ensure(map, r.subsidiaryId);
    s.totalPackages += rem;
    s.inProcessPackages += rem;
  }

  // Otros = residual que garantiza el cuadre contra el total.
  for (const s of map.values()) {
    s.otherPackages = Math.max(
      0,
      s.totalPackages - s.deliveredPackages - s.undeliveredPackages - s.inProcessPackages,
    );
  }
  return map;
}
