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
// Carga F2: misma forma que un status agg (las cargas cuentan junto con los shipments).
const charge = (o: Partial<OperationalChargeAgg>): OperationalChargeAgg => ship(o);
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

  it('desglose y cuadre exacto por sucursal (paquetes + cargas combinados)', () => {
    const map = buildOperationalStats({
      // 10 shipments (6 POD, 1+1 DEX, 2 en proceso) + 3 cargas F2 (todas entregadas).
      shipmentAgg: [ship({ subsidiaryId: 's1', total: 10, entregado: 6, dex07: 1, dex03: 1, pendienteMov: 2 })],
      chargeAgg: [charge({ subsidiaryId: 's1', total: 3, entregado: 3 })],
      consolidationRows: [cons('s1', 'ordinario'), cons('s1', 'aereo')],
    });
    const s = map.get('s1')!;
    expect(s.totalPackages).toBe(13);          // 10 shipments + 3 cargas (combinado)
    expect(s.deliveredPackages).toBe(9);       // 6 + 3
    expect(s.undeliveredPackages).toBe(2);     // dex03 + dex07 + dex08
    expect(s.byExceptionCode).toEqual({ code07: 1, code08: 0, code03: 1, unknown: 0 });
    expect(s.inProcessPackages).toBe(2);
    expect(s.otherPackages).toBe(0);           // 13 - 9 - 2 - 2
    expect(s.totalCharges).toBe(3);            // # de cargas F2 (indicador aparte)
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

  it('cargas F2 cuentan JUNTO con los paquetes (total + desglose) y ademas en totalCharges', () => {
    // Consolidado cuyas guias viven en charge_shipment (F2): antes daban totalPackages=0.
    const map = buildOperationalStats({
      shipmentAgg: [],
      chargeAgg: [charge({ subsidiaryId: 'guaymas', total: 7, entregado: 5, dex07: 2 })],
      consolidationRows: [],
    });
    const s = map.get('guaymas')!;
    expect(s.totalPackages).toBe(7);      // ya NO es 0: las cargas cuentan
    expect(s.deliveredPackages).toBe(5);
    expect(s.undeliveredPackages).toBe(2);
    expect(s.totalCharges).toBe(7);       // indicador aparte del # de cargas
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(7);
  });

  it('ignora filas sin subsidiaryId', () => {
    const map = buildOperationalStats({
      shipmentAgg: [ship({ subsidiaryId: null, total: 9, entregado: 9 })],
      chargeAgg: [charge({ subsidiaryId: '', total: 3 })],
      consolidationRows: [cons('', 'ordinario')],
    });
    expect(map.size).toBe(0);
  });

  it('remanente declarado sin distribuir suma al DUEÑO (bodega) como total + en proceso', () => {
    // Consolidado de bodega declarado 40, con 0 guias ligadas todavia -> remanente 40 a la bodega.
    const map = buildOperationalStats({
      shipmentAgg: [],
      chargeAgg: [],
      consolidationRows: [cons('bodega', 'ordinario')],
      ownerRemainder: [{ subsidiaryId: 'bodega', remainder: 40 }],
    });
    const s = map.get('bodega')!;
    expect(s.totalPackages).toBe(40);
    expect(s.inProcessPackages).toBe(40);
    expect(s.deliveredPackages).toBe(0);
    expect(s.otherPackages).toBe(0);
    // CUADRE: POD + DEX + En proceso + Otros = Total
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(40);
  });

  it('conforme se escanea, parte va a la satelite y el remanente baja (cuadre se mantiene)', () => {
    // Declarado 40; 25 ya ligadas y operadas (15 bodega + 10 huatabampo); remanente 15 a la bodega.
    const map = buildOperationalStats({
      shipmentAgg: [
        ship({ subsidiaryId: 'bodega', total: 15, entregado: 10, pendienteMov: 5 }),
        ship({ subsidiaryId: 'huatabampo', total: 10, entregado: 10 }),
      ],
      chargeAgg: [],
      consolidationRows: [cons('bodega', 'ordinario')],
      ownerRemainder: [{ subsidiaryId: 'bodega', remainder: 15 }],
    });
    const bodega = map.get('bodega')!;
    expect(bodega.totalPackages).toBe(30);        // 15 operadas + 15 remanente
    expect(bodega.inProcessPackages).toBe(20);    // 5 pendientes reales + 15 remanente
    expect(bodega.deliveredPackages).toBe(10);
    expect(bodega.deliveredPackages + bodega.undeliveredPackages + bodega.inProcessPackages + bodega.otherPackages).toBe(bodega.totalPackages);
    const hua = map.get('huatabampo')!;
    expect(hua.totalPackages).toBe(10);
    expect(hua.deliveredPackages).toBe(10);
  });

  it('remanente <= 0 (todo escaneado o de mas) no suma nada', () => {
    const map = buildOperationalStats({
      shipmentAgg: [ship({ subsidiaryId: 'bodega', total: 42, entregado: 42 })],
      chargeAgg: [],
      consolidationRows: [cons('bodega', 'ordinario')],
      ownerRemainder: [{ subsidiaryId: 'bodega', remainder: 0 }, { subsidiaryId: 'bodega', remainder: -3 }],
    });
    const s = map.get('bodega')!;
    expect(s.totalPackages).toBe(42);
    expect(s.inProcessPackages).toBe(0);
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
