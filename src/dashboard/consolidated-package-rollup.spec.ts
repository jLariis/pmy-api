import {
  rollupConsolidatedPackageStats,
  rollupOperationalPackageStats,
  emptyPackageStats,
  ConsolidatedRollupInput,
  OperationalConsolidatedRow,
  OperationalGroupRow,
} from './consolidated-package-rollup';

const row = (o: Partial<ConsolidatedRollupInput>): ConsolidatedRollupInput => ({
  subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 0,
  entregado: 0, dex03: 0, dex07: 0, dex08: 0, guiasPendientesDeMov: 0, countF2: 0, ...o,
});

describe('rollupConsolidatedPackageStats', () => {
  it('suma numberOfPackages (declarado) y el desglose real por sucursal', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 10, entregado: 4, dex07: 1, guiasPendientesDeMov: 2, countF2: 3 }),
      row({ subsidiaryId: 's1', type: 'aereo', numberOfPackages: 5, entregado: 2, dex03: 1, guiasPendientesDeMov: 1, countF2: 1 }),
    ]);
    const s = map.get('s1')!;
    expect(s.totalPackages).toBe(15);          // declarado
    expect(s.deliveredPackages).toBe(6);
    expect(s.undeliveredPackages).toBe(2);     // dex03+dex07+dex08 = 1+1+0
    expect(s.byExceptionCode).toEqual({ code07: 1, code08: 0, code03: 1, unknown: 0 });
    expect(s.inProcessPackages).toBe(3);       // guiasPendientesDeMov = 2+1
    expect(s.totalCharges).toBe(4);            // countF2 = 3+1
    expect(s.consolidations).toEqual({ ordinary: 1, air: 1, total: 2 });
    // Otros = residual: 15 - 6 - 2 - 3 = 4
    expect(s.otherPackages).toBe(4);
    // CUADRE EXACTO: POD + DEX + En proceso + Otros = Total
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(s.totalPackages);
  });

  it('Otros hace cuadrar exacto cuando declarado > desglose real', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: 100, entregado: 60, dex07: 5, guiasPendientesDeMov: 20 }),
    ]);
    const s = map.get('s1')!;
    expect(s.otherPackages).toBe(15); // 100 - 60 - 5 - 20
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(100);
  });

  it('clampa Otros a 0 cuando declarado < desglose real (borde raro)', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: 5, entregado: 4, dex07: 2, guiasPendientesDeMov: 1 }),
    ]);
    // 5 - 4 - 2 - 1 = -2 -> clamp a 0
    expect(map.get('s1')!.otherPackages).toBe(0);
  });

  it('clasifica carga en el total pero no en ordinary/air', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', type: 'carga', numberOfPackages: 7 }),
      row({ subsidiaryId: 's1', type: 'ordinario', numberOfPackages: 3 }),
    ]);
    const s = map.get('s1')!;
    expect(s.consolidations).toEqual({ ordinary: 1, air: 0, total: 2 });
    expect(s.totalPackages).toBe(10);
  });

  it('coacciona numberOfPackages string/null a numero', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: '8' as any }),
      row({ subsidiaryId: 's1', numberOfPackages: null as any }),
    ]);
    expect(map.get('s1')!.totalPackages).toBe(8);
  });

  it('separa sucursales distintas', () => {
    const map = rollupConsolidatedPackageStats([
      row({ subsidiaryId: 's1', numberOfPackages: 4 }),
      row({ subsidiaryId: 's2', numberOfPackages: 9 }),
    ]);
    expect(map.get('s1')!.totalPackages).toBe(4);
    expect(map.get('s2')!.totalPackages).toBe(9);
  });

  it('emptyPackageStats devuelve todo en cero', () => {
    expect(emptyPackageStats()).toEqual({
      totalPackages: 0, deliveredPackages: 0, undeliveredPackages: 0,
      byExceptionCode: { code07: 0, code08: 0, code03: 0, unknown: 0 },
      inProcessPackages: 0, otherPackages: 0, totalCharges: 0,
      consolidations: { ordinary: 0, air: 0, total: 0 },
    });
  });
});

describe('paridad dashboard vs pantalla Consolidados', () => {
  it('el rollup reproduce la suma directa de findAll para el mismo scope', () => {
    // Salida simulada de ConsolidatedService.findAll (subset de shipmentCounts que usa el rollup)
    const findAllOut = [
      { subsidiary: { id: 's1' }, type: 'ordinario', numberOfPackages: 20, shipmentCounts: { entregado: 12, dex03: 1, dex07: 2, dex08: 0, guiasPendientesDeMov: 3, countF2: 4 } },
      { subsidiary: { id: 's1' }, type: 'aereo',     numberOfPackages: 8,  shipmentCounts: { entregado: 5,  dex03: 0, dex07: 1, dex08: 1, guiasPendientesDeMov: 1, countF2: 0 } },
      { subsidiary: { id: 's2' }, type: 'carga',     numberOfPackages: 30, shipmentCounts: { entregado: 25, dex03: 2, dex07: 0, dex08: 0, guiasPendientesDeMov: 2, countF2: 9 } },
    ];

    // Adaptador identico al de kpi.service (getSubsidiariesKpis)
    const rows: ConsolidatedRollupInput[] = findAllOut.map((c: any) => ({
      subsidiaryId: c.subsidiary.id, type: c.type, numberOfPackages: c.numberOfPackages,
      entregado: c.shipmentCounts.entregado, dex03: c.shipmentCounts.dex03,
      dex07: c.shipmentCounts.dex07, dex08: c.shipmentCounts.dex08,
      guiasPendientesDeMov: c.shipmentCounts.guiasPendientesDeMov, countF2: c.shipmentCounts.countF2,
    }));
    const map = rollupConsolidatedPackageStats(rows);

    // Suma directa "a mano" (lo que hace la pantalla de Consolidados)
    const sum = (sub: string, f: (c: any) => number) =>
      findAllOut.filter(c => c.subsidiary.id === sub).reduce((a, c) => a + f(c), 0);

    for (const sub of ['s1', 's2']) {
      const s = map.get(sub)!;
      expect(s.totalPackages).toBe(sum(sub, c => c.numberOfPackages));
      expect(s.deliveredPackages).toBe(sum(sub, c => c.shipmentCounts.entregado));
      expect(s.undeliveredPackages).toBe(sum(sub, c => c.shipmentCounts.dex03 + c.shipmentCounts.dex07 + c.shipmentCounts.dex08));
      expect(s.inProcessPackages).toBe(sum(sub, c => c.shipmentCounts.guiasPendientesDeMov));
      // Cuadre exacto en cada sucursal
      expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(s.totalPackages);
    }
  });
});

describe('rollupOperationalPackageStats — traspasos entre sucursales', () => {
  const cons = (o: Partial<OperationalConsolidatedRow>): OperationalConsolidatedRow => ({
    id: 'c1', ownerId: 'bodega-hmo', numberOfPackages: 0, type: 'ordinario', ...o,
  });
  const grp = (o: Partial<OperationalGroupRow>): OperationalGroupRow => ({
    ownerId: 'bodega-hmo', opSub: 'bodega-hmo', total: 0,
    entregado: 0, dex03: 0, dex07: 0, dex08: 0, pendienteMov: 0, ...o,
  });

  it('mueve las guías traspasadas al DESTINO y las descuenta del dueño; consolidado se queda con el dueño', () => {
    // Consolidado de Bodega Hermosillo declara 10 guías; 4 se traspasaron a Caborca.
    const consolidados = [cons({ id: 'c1', ownerId: 'bodega-hmo', numberOfPackages: 10, type: 'ordinario' })];
    const shipmentGroups: OperationalGroupRow[] = [
      // 6 se quedaron en Bodega Hermosillo (operativa = dueño)
      grp({ ownerId: 'bodega-hmo', opSub: 'bodega-hmo', total: 6, entregado: 3, dex07: 1, pendienteMov: 2 }),
      // 4 traspasadas a Caborca (operativa ≠ dueño)
      grp({ ownerId: 'bodega-hmo', opSub: 'caborca', total: 4, entregado: 2, dex08: 1, pendienteMov: 1 }),
    ];
    const map = rollupOperationalPackageStats(consolidados, shipmentGroups, []);

    const hmo = map.get('bodega-hmo')!;
    const caborca = map.get('caborca')!;

    // Total: 10 declarado − 4 traspasadas = 6 en el dueño; 4 en el destino.
    expect(hmo.totalPackages).toBe(6);
    expect(caborca.totalPackages).toBe(4);
    // El gran total se conserva.
    expect(hmo.totalPackages + caborca.totalPackages).toBe(10);

    // Desglose por sucursal OPERATIVA.
    expect(hmo.deliveredPackages).toBe(3);
    expect(caborca.deliveredPackages).toBe(2);
    expect(caborca.byExceptionCode.code08).toBe(1);
    expect(caborca.inProcessPackages).toBe(1);

    // El consolidado (ordinario) se queda con el DUEÑO; Caborca no suma consolidados.
    expect(hmo.consolidations).toEqual({ ordinary: 1, air: 0, total: 1 });
    expect(caborca.consolidations).toEqual({ ordinary: 0, air: 0, total: 0 });
  });

  it('cargas (F2) traspasadas cuentan en el destino', () => {
    const consolidados = [cons({ id: 'c1', ownerId: 'bodega-obregon', numberOfPackages: 0, type: 'carga' })];
    const chargeGroups: OperationalGroupRow[] = [
      grp({ ownerId: 'bodega-obregon', opSub: 'huatabampo', total: 5, entregado: 5 }),
    ];
    const map = rollupOperationalPackageStats(consolidados, [], chargeGroups);
    expect(map.get('huatabampo')!.totalCharges).toBe(5);
    expect(map.get('huatabampo')!.deliveredPackages).toBe(5);
  });

  it('sin traspasos: se comporta como el conteo por dueño', () => {
    const consolidados = [cons({ id: 'c1', ownerId: 's1', numberOfPackages: 8, type: 'ordinario' })];
    const shipmentGroups: OperationalGroupRow[] = [
      grp({ ownerId: 's1', opSub: 's1', total: 8, entregado: 6, dex07: 1, pendienteMov: 1 }),
    ];
    const s = rollupOperationalPackageStats(consolidados, shipmentGroups, []).get('s1')!;
    expect(s.totalPackages).toBe(8);
    expect(s.deliveredPackages).toBe(6);
    expect(s.deliveredPackages + s.undeliveredPackages + s.inProcessPackages + s.otherPackages).toBe(8);
  });
});
