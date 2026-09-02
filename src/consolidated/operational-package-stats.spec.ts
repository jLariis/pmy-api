import {
  buildOperationalStats,
  emptyPackageStats,
  OperationalStatusAgg,
  OperationalChargeAgg,
  ConsolidationOwnerRow,
} from './operational-package-stats';

const ship = (o: Partial<OperationalStatusAgg>): OperationalStatusAgg => ({
  subsidiaryId: 's1', total: 0, entregado: 0, dex03: 0, dex07: 0, dex08: 0, pendienteMov: 0, ...o,
});
const charge = (subsidiaryId: string, total: number): OperationalChargeAgg => ({ subsidiaryId, total });
const cons = (subsidiaryId: string, type: string): ConsolidationOwnerRow => ({ subsidiaryId, type });

describe('buildOperationalStats (dashboard por sucursal operativa)', () => {
  it('fan-out: el consolidado de la bodega se reparte y cada sucursal recibe SU conteo', () => {
    // Un consolidado dueño = bodega, pero las guias las operan 3 sucursales distintas.
    const map = buildOperationalStats({
      shipmentAgg: [
        ship({ subsidiaryId: 'bodega', total: 4, entregado: 4 }),        // lo que la bodega retuvo/entrego
        ship({ subsidiaryId: 'huatabampo', total: 6, entregado: 5, dex07: 1 }),
        ship({ subsidiaryId: 'navojoa', total: 3, entregado: 2, pendienteMov: 1 }),
      ],
      chargeAgg: [],
      consolidationRows: [cons('bodega', 'ordinario')], // el consolidado pertenece a la bodega
    });

    expect(map.get('bodega')!.totalPackages).toBe(4);
    expect(map.get('huatabampo')!.totalPackages).toBe(6);
    expect(map.get('navojoa')!.totalPackages).toBe(3);

    // La bodega NO se infla con lo que reparte; solo cuenta lo que ella opera.
    expect(map.get('bodega')!.deliveredPackages).toBe(4);
    // Consolidations quedan por dueño: solo la bodega.
    expect(map.get('bodega')!.consolidations).toEqual({ ordinary: 1, air: 0, total: 1 });
    expect(map.get('huatabampo')!.consolidations).toEqual({ ordinary: 0, air: 0, total: 0 });
  });

  it('desglose y cuadre exacto por sucursal (solo paquetes)', () => {
    const map = buildOperationalStats({
      shipmentAgg: [ship({ subsidiaryId: 's1', total: 10, entregado: 6, dex07: 1, dex03: 1, pendienteMov: 2 })],
      chargeAgg: [charge('s1', 3)],
      consolidationRows: [cons('s1', 'ordinario'), cons('s1', 'aereo')],
    });
    const s = map.get('s1')!;
    expect(s.totalPackages).toBe(10);
    expect(s.deliveredPackages).toBe(6);
    expect(s.undeliveredPackages).toBe(2); // dex03 + dex07 + dex08
    expect(s.byExceptionCode).toEqual({ code07: 1, code08: 0, code03: 1, unknown: 0 });
    expect(s.inProcessPackages).toBe(2);
    expect(s.otherPackages).toBe(0); // 10 - 6 - 2 - 2
    expect(s.totalCharges).toBe(3);
    expect(s.consolidations).toEqual({ ordinary: 1, air: 1, total: 2 });
    // CUADRE EXACTO: POD + DEX + En proceso + Otros = Total
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(s.totalPackages);
  });

  it('Otros hace cuadrar cuando hay desenlaces fuera de POD/DEX/pendiente (devueltos, ocurre, etc.)', () => {
    // total 20, pero entregado 12 + dex 3 + pendiente 2 = 17 -> 3 en "otros".
    const map = buildOperationalStats({
      shipmentAgg: [ship({ subsidiaryId: 's1', total: 20, entregado: 12, dex07: 3, pendienteMov: 2 })],
      chargeAgg: [],
      consolidationRows: [],
    });
    const s = map.get('s1')!;
    expect(s.otherPackages).toBe(3);
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(20);
  });

  it('satelite que solo recibe traspasos: totalPackages > 0 y consolidations = 0', () => {
    const map = buildOperationalStats({
      shipmentAgg: [ship({ subsidiaryId: 'vicam', total: 5, entregado: 5 })],
      chargeAgg: [],
      consolidationRows: [],
    });
    const s = map.get('vicam')!;
    expect(s.totalPackages).toBe(5);
    expect(s.consolidations).toEqual({ ordinary: 0, air: 0, total: 0 });
  });

  it('cargas F2 se atribuyen por sucursal operativa y no entran al cuadre de paquetes', () => {
    const map = buildOperationalStats({
      shipmentAgg: [],
      chargeAgg: [charge('guaymas', 7)],
      consolidationRows: [],
    });
    const s = map.get('guaymas')!;
    expect(s.totalCharges).toBe(7);
    expect(s.totalPackages).toBe(0);
    expect(s.deliveredPackages).toBe(0);
  });

  it('ignora filas sin subsidiaryId', () => {
    const map = buildOperationalStats({
      shipmentAgg: [ship({ subsidiaryId: null, total: 9, entregado: 9 })],
      chargeAgg: [charge('', 3)],
      consolidationRows: [cons('', 'ordinario')],
    });
    expect(map.size).toBe(0);
  });

  it('emptyPackageStats arranca en ceros', () => {
    expect(emptyPackageStats()).toEqual({
      totalPackages: 0,
      deliveredPackages: 0,
      undeliveredPackages: 0,
      byExceptionCode: { code07: 0, code08: 0, code03: 0, unknown: 0 },
      inProcessPackages: 0,
      otherPackages: 0,
      totalCharges: 0,
      consolidations: { ordinary: 0, air: 0, total: 0 },
    });
  });
});
